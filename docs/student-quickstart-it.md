# JupyterLite + Google Drive: guida per gli studenti

**Versione sperimentale.** Usa soltanto notebook di prova e dati non sensibili, con un account abilitato dal docente.

1. Apri [JupyterLite](https://lmari.github.io/jupyterlite-google-drive/lab/index.html?path=primi-passi.ipynb). Non occorre installare Python. Il notebook primi-passi.ipynb contiene un esercizio guidato.
2. Esegui una cella con Ctrl+Invio. Apri il pannello Drive da File → Google Drive: Show workspace. Con Connect to Google Drive autorizza l'account. Il notebook iniziale rimane locale.
3. Usa Save notebook as new Drive copy, poi Refresh notebook list e apri la copia remota. Ctrl+S salva sul file remoto soltanto quando stai lavorando nella copia remota. Controlla lo stato di salvataggio.
4. Carica su Drive un CSV di prova dati.csv, con intestazione x,y e righe 2,3 e 4,5. Nel notebook remoto usa Mount data file… e Add selected dependency… per registrare il file. Salva.
5. Esegui le celle dell'esercizio. I dati montati sono in sola lettura. I file sotto /drive/output/ sono temporanei: esportali o scaricali prima di chiudere.
6. Da un altro dispositivo, collega lo stesso account, apri il notebook remoto, scegli Restore notebook data dependencies e riesegui il codice dall'inizio.

## Se qualcosa non funziona

- Authorization expired: scegli Renew authorization con lo stesso account.
- Save failed: scarica il notebook con Download notebook recovery file prima di chiudere; non sovrascrivere il file di un altro editor.
- Se non puoi leggere /drive/data, avvisa il docente; la copia temporanea è una modalità alternativa con un percorso diverso.
- Non condividere token, credenziali o dati privati nei messaggi di errore.

Il notebook conserva codice, output salvati e riferimenti ai dati, non lo stato delle variabili Python. I dati sono riferimenti alla versione corrente dei file, non copie immutabili. Evita modifiche concorrenti allo stesso notebook da due dispositivi. Il browser potrebbe non avvisarti prima di chiudere: scarica il lavoro importante.

Per docenti: prima dell'uso in aula completare il [collaudo reale](acceptance.md). La versione candidata è ancora sperimentale.
