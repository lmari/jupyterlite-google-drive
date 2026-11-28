// Adapt the already initialized Pyodide DriveFS, retaining its actual transport
// (service worker or shared memory). No Python open monkeypatch, data copy or token.
export const bootstrap = `def _jupyterlite_install_dual_mount():
    from pyodide_js import FS
    from pyodide.ffi import to_js
    from js import Object
    if not FS.analyzePath('/drive').exists:
        return
    old = FS.lookupPath('/drive').node.mount.type
    if not hasattr(old, 'API'):
        return
    if FS.analyzePath('/local').exists:
        raise RuntimeError('Cannot mount local filesystem: /local already exists')
    cwd = str(FS.cwd())
    original = str(old.driveName)
    options = dict(FS=old.FS, PATH=old.PATH, ERRNO_CODES=old.ERRNO_CODES,
                   driveName='', mountpoint='/local')
    for key in ('baseUrl', 'browsingContextId'):
        value = getattr(old.API, '_' + key, None)
        if value is not None:
            options[key] = value
    local = old.constructor.new(to_js(options, dict_converter=Object.fromEntries))
    FS.mkdirTree('/local')
    FS.mount(local, Object.new(), '/local')
    old.API._driveName = 'GoogleDrive'
    old.driveName = 'GoogleDrive'
    if not original and (cwd == '/drive' or cwd.startswith('/drive/')):
        FS.chdir('/local' + cwd[len('/drive'):])
try:
    _jupyterlite_install_dual_mount()
finally:
    del _jupyterlite_install_dual_mount
`;

// Wrap the registered factory rather than modifying the upstream worker bundle.
// Install before the first execute request; also works after a kernel restart.
export function installDualMount(specs) {
  const wrapped = new WeakSet();
  const install = () => {
    const factory=specs.factories.get('python');
    if(!factory || wrapped.has(factory)) return;
    const create=async options=>{
      const kernel=await factory(options);
      const execute=kernel.executeRequest.bind(kernel);
      let initialized=false;
      kernel.executeRequest=async content=>{
        if(!initialized) {
          const result=await execute({code:bootstrap,silent:true,store_history:false,allow_stdin:false,stop_on_error:true});
          if(result.status!=='ok') return result;
          initialized=true;
        }
        return execute(content);
      };
      return kernel;
    };
    wrapped.add(create);
    specs.factories.set('python',create);
  };
  specs.changed.connect(install);
  install();
}
