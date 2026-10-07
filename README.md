# Jev Business Decision Lab

Mini-lab locale per testare Jev su decisioni aziendali osservabili, usando dati pubblici ufficiali.

## Cosa include

- Interfaccia web locale, senza framework frontend.
- Vercel AI Gateway come provider predefinito per il Jev proprietario.
- Cloudflare disponibile come alternativa, ma anch'esso richiede credito per Jev.
- Run singoli o ripetuti per osservare stabilità e latenza.
- Batch fino a 20 record, con accuratezza rispetto alle etichette ufficiali.
- Visualizzazione delle distribuzioni di probabilità e del JSON grezzo.
- Confronto con etichette ufficiali quando il dataset lo consente.
- Nessun input o risultato scritto su disco dal server.

## Dataset

Ogni dataset è una cartella in `datasets/`:

- `dataset.json`: nome, domanda business, avvertenze, la fonte da interrogare (`source.adapter`) e i suoi parametri;
- `questions.json`: le domande per Jev e SemIf, nello stesso formato delle API;
- `profile.json`, facoltativo: entra nello state sotto la chiave `profileKey`, per esempio il profilo della vostra azienda.

Il server rilegge le cartelle a ogni caricamento della pagina: una cartella nuova compare nel menu senza riavviare niente. Nelle cartelle ci sono solo file JSON. Il codice che interroga le fonti sta in `src/sources/`, un adattatore per fonte. Le domande che hanno un riferimento ufficiale devono mantenere l'id e le chiavi delle opzioni che l'adattatore ricava: se le cambiate, il confronto con l'etichetta sparisce.

### Il vostro dataset

La cartella `datasets/email-pmi` usa l'adattatore `local`, che legge `records.jsonl`: una riga per record, con `state` ed `expected`. Per provare Jev e SemIf sul vostro processo copiate la cartella, sostituite le righe con una ventina di esempi vostri, ognuno con l'etichetta giusta, e adattate domande e metadati. Con Jev i record escono dal computer: usate dati sintetici o anonimizzati. Con SemIf restano sul vostro computer.

Una cartella che non volete pubblicare si aggiunge al `.gitignore`: il lab la legge lo stesso.

### TED gare pubbliche italiane

Bandi e avvisi pubblicati su Tenders Electronic Daily, il portale ufficiale UE degli appalti. Il lab lavora in trasparenza: lo state contiene tutto quello che TED restituisce sull'avviso, cioè titolo italiano, committente, data, codici CPV e natura ufficiale del contratto, più il profilo dei servizi AI, MAX. Anche il titolo porta la categoria ufficiale, perché TED lo compone come `Italia – [descrizione del CPV] – [titolo]`. I riferimenti sono le traduzioni dei campi ufficiali nelle categorie del lab.

Caso business: filtrare automaticamente le opportunità e instradarle al team commerciale corretto prima della lettura completa. La domanda sul settore misura proprio questo, la traduzione della classificazione ufficiale nelle dieci categorie commerciali del lab, perché è il lavoro reale di chi smista i bandi. Oltre al settore e alla natura del contratto, Jev valuta la rilevanza per AI, MAX, la compatibilità con l'Academy, il servizio più adatto e se il bando meriti una lettura umana. Solo le prime due domande hanno un riferimento ufficiale: le altre sono giudizi, e si leggono come tali.

Limite importante: la natura del contratto è in chiaro e la domanda che la riguarda si riduce a una lettura del campo. Il codice CPV viene normalizzato in dieci macrosettori costruiti dal lab, e molti bandi sono lotti dello stesso appalto, quindi in un batch lo stesso caso può contare più volte. Un match semantico non dimostra il possesso dei requisiti tecnici o amministrativi per partecipare.

Fonte: https://docs.ted.europa.eu/api/latest/search.html

### openFDA Enforcement Reports

Richiami reali di alimenti, farmaci e dispositivi. Il lab invia a Jev prodotto, motivazione, distribuzione e contesto operativo. La classificazione FDA, Class I, II o III, viene tenuta fuori dallo state e usata dopo come riferimento.

Limite importante: openFDA non va usato per decisioni mediche, avvisi al pubblico o monitoraggio completo del ciclo di vita di un richiamo. Il test valuta la lettura semantica di un record già classificato.

Fonte: https://open.fda.gov/apis/food/enforcement/

### CPSC Product Recalls

Richiami pubblici di prodotti di consumo. Jev classifica il pericolo, valuta la severità, sceglie il rimedio e decide se il caso merita escalation esecutiva. Pericolo e rimedio ufficiali consentono un confronto trasparente.

Limite importante: sono richiami già pubblicati e confermati. Il lab non misura la capacità di prevedere incidenti futuri.

Fonte: https://www.cpsc.gov/Data

### Incentivi.gov.it, incentivi aperti alle imprese

Il catalogo nazionale del MIMIT: oltre 6.000 schede di ministeri, regioni e camere di commercio, di cui il lab carica soltanto quelle ancora aperte, dalla più recente. Jev legge titolo, ente, territorio e descrizione. Finalità, forma di agevolazione e dimensioni d'impresa ammesse restano nascoste e servono da riferimento. Quando il catalogo assegna più finalità alla stessa scheda, una qualsiasi vale come risposta corretta.

Caso business: la domanda che ogni imprenditore si fa davanti a un bando, «fa per noi?». Lo state contiene un `profilo_azienda` di esempio: sostituitelo con regione, dimensione, settore e obiettivi della vostra impresa e osservate come cambia `interesse_per_profilo`.

Accanto c'è un `profilo_fornitore` con i servizi AI, MAX, e due domande senza riferimento ufficiale: che cosa copre l'incentivo fra formazione e adozione dell'intelligenza artificiale, e quale servizio potrebbe rientrare fra le spese ammissibili. Servono a passare dalla domanda «fa per noi?» a «con quale incentivo si finanzia il progetto?».

Limite importante: la forma di agevolazione è fondo perduto in oltre il 90% delle schede. Un modello che risponde sempre così ottiene un'accuratezza altissima senza aver letto niente: è il motivo per cui l'accuratezza da sola non basta. Nel profilo inserite soltanto dati generici, mai nomi o numeri riservati.

Fonte: https://www.incentivi.gov.it/it/open-data (licenza IODL 2.0). Il lab interroga lo stesso endpoint Solr da cui la pagina Open Data genera l'export.

### Safety Gate UE, prodotti pericolosi in italiano

Le allerte europee sui prodotti non alimentari pericolosi, dal report settimanale ufficiale in italiano. Jev riceve categoria, prodotto, marca, descrizione del pericolo e paesi coinvolti. Tipo di rischio, livello e misure adottate restano nascosti.

Caso business: un distributore italiano deve capire in fretta se un'allerta lo riguarda e quanto è urgente. È l'equivalente europeo del dataset CPSC, su prodotti venduti anche in Italia.

Limite importante: la descrizione del pericolo spesso nomina il rischio, quindi il tipo di rischio è il test facile e la misura adottata quello difficile. Quasi tutte le allerte sono classificate come rischio grave, per questo il livello non è una domanda.

Fonte: https://ec.europa.eu/safety-gate-alerts/screen/webReport

### Prompt injection, il guardiano dell'agente

116 messaggi di test pubblicati da deepset, etichettati come legittimi o manipolatori. Il lab ne carica metà e metà e li presenta come domande in arrivo all'assistente AI di un quotidiano. Jev decide se il messaggio cerca di cambiare istruzioni, ruolo o compito all'assistente, e quale azione deve eseguire il codice prima di passarglielo.

Caso business: lo scenario del guardiano, il controllo rapido prima che un agente agisca.

Limite importante: deepset considera injection anche le richieste che assegnano all'assistente un compito diverso, come giochi di ruolo o generazione di codice. I messaggi sono soprattutto in inglese e tedesco.

Fonte: https://huggingface.co/datasets/deepset/prompt-injections (Apache 2.0)

### CLINC150, centralino bancario e richieste fuori perimetro

Richieste brevi di clienti a un assistente. Il lab tiene i 30 intenti bancari e di carte di credito, li raggruppa in 5 reparti e mescola circa il 40% di richieste fuori perimetro, che non appartengono a nessun reparto. Jev risponde alla stessa richiesta con due menu: uno con l'opzione `fuori_perimetro`, uno senza.

Caso business: misurare se Jev sa di non sapere. Nel menu senza uscita, su una richiesta fuori perimetro ogni scelta è sbagliata per costruzione: il dato interessante è la confidenza con cui sbaglia.

Limite importante: il raggruppamento dei 30 intenti in 5 reparti è una normalizzazione costruita dal lab e dichiarata nel codice. Alcune etichette originali sono discutibili: nascono per la ricerca, non per un servizio clienti reale. Testi in inglese.

Fonte: https://github.com/clinc/oos-eval (CC BY 3.0)

## Installazione

```bash
git clone https://github.com/maxturazzini/system-one-lab.git
cd system-one-lab
npm install
cp .env.example .env
```

### Cloudflare

Create un account Cloudflare gratuito. Nel dashboard aprite **Workers AI**, selezionate **Use REST API**, create il token precompilato e copiate anche l'Account ID.

Inseriteli in `.env`:

```dotenv
JEV_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Cloudflare include 10.000 neuroni al giorno per i modelli ospitati con identificativo `@cf/...`. **Jev è invece un modello third-party `typesafe/jev`**: richiede saldo AI Gateway oppure una chiave TypeSafe configurata come BYOK. I neuroni gratuiti del piano Workers Free non coprono Jev.

Secondo la policy Workers AI, Cloudflare non usa i contenuti per addestrare modelli o migliorare servizi e non li conserva, salvo l'uso esplicito di un servizio di storage Cloudflare.

Fonti: https://developers.cloudflare.com/workers-ai/platform/pricing/ e https://developers.cloudflare.com/workers-ai/platform/data-usage/

### Alternativa: Vercel

Create una chiave su https://vercel.com/ai-gateway e inseritela in `.env`:

```dotenv
AI_GATEWAY_API_KEY=...
```

Vercel offre 5 dollari gratuiti al mese ma richiede una carta valida per sbloccarli. Zero Data Retention è disponibile soltanto sui piani Pro ed Enterprise. Sul piano Hobby il lab imposta `JEV_ZERO_DATA_RETENTION=false` e deve essere usato esclusivamente con dati pubblici o sintetici.

Con `JEV_PROVIDER=auto`, il lab preferisce Vercel quando trova una chiave Vercel configurata; usa Cloudflare soltanto quando Vercel non è disponibile. Entrambe le strade richiedono fatturazione per il Jev proprietario. Le credenziali aggiunte a `.env` vengono rilette automaticamente: ricaricate la pagina per aggiornare l'indicatore.

### Alternativa realmente gratuita e locale: SemIf dentro il lab

[SemIf](https://openjev.com/), precedentemente OpenJev ([codice](https://github.com/TheoLeeCJ/SemIf-OpenJev), MIT), legge le decisioni direttamente dai logit di un modello open-weight. Il lab lo usa come secondo motore, accanto a Jev: stessi dataset, stesse domande, stesse etichette di riferimento. Gli input non lasciano il computer e non servono account, carta o chiave API. Escono soltanto, una volta, le richieste dei pesi del modello e del tokenizer a Hugging Face.

Il lab non riscrive la tecnica. Un piccolo server Python, `semif/server.py`, importa il pacchetto `semif_phase1` e chiama il suo backend llama.cpp: è la stessa strada di `semif-score --mode direct --backend llamacpp`, con il modello tenuto in memoria fra una domanda e l'altra. Prompt, tokenizzazione, verifica degli slot di risposta e lettura dei logit sono quelli di SemIf. Il lab aggiunge solo l'adattatore in `src/semif.mjs`, che traduce le domande di Jev in righe SemIf e le risposte nella forma di Jev: le scelte restano scelte, le domande sì/no diventano due opzioni, i punteggi un'opzione per livello.

Un test lo verifica: sui 20 bandi TED valutati con la CLI il 22/09 (`results/ted20.jsonl`), l'adattatore ricostruisce le 40 righe identiche, quindi lo stesso prompt.

Installazione, una volta:

```bash
git clone https://github.com/TheoLeeCJ/SemIf-OpenJev.git ~/git/SemIf
python3 -m venv ~/.venvs/semif
~/.venvs/semif/bin/pip install -e "$HOME/git/SemIf[llamacpp]"
```

`npm start` avvia anche il server SemIf con quel Python, sulla porta 4318. Si cambia con queste variabili in `.env`:

```dotenv
SEMIF_PYTHON=/percorso/del/python   # default ~/.venvs/semif/bin/python
SEMIF_PORT=4318
SEMIF_MODE=direct                   # serial: lo state si legge una volta per record, più veloce
SEMIF_THREADS=                      # default: tutti i core
SEMIF_URL=                          # server SemIf già avviato altrove: il lab non ne lancia uno
```

I file GGUF finiscono in `~/.cache/jev-lab/semif/` (`SEMIF_CACHE_DIR` per cambiarlo), fuori dalla cartella del lab.

Come si usa:

1. Nella sezione Decisione scegliete il modello e premete Carica. Qwen3 0.6B pesa 639 MB, MiniCPM5 2B 1,56 GB, Qwen3.5 4B 3,01 GB. Sono gli stessi checkpoint della demo di SemIf, alla stessa revisione.
2. Selezionate un record e premete **Chiedi a SemIf**. Se premete anche **Chiedi a Jev** sullo stesso input, le risposte compaiono affiancate.
3. **Batch con SemIf in locale** valuta tutti i record caricati, senza il limite del batch Jev, perché non costa niente.

Differenze da tenere presenti:

- SemIf **non è Jev**: non offre la calibrazione RLCD dichiarata da TypeSafe. Serve a provare il paradigma, non a misurare il prodotto Jev.
- Jev risponde a tutte le domande in una chiamata. SemIf fa un passaggio del modello per domanda: i tempi non sono confrontabili uno a uno.
- Il backend llama.cpp di SemIf gira sulla CPU. Con MiniCPM5 2B una domanda richiede qualche secondo; `SEMIF_MODE=serial` riusa lo state fra le domande dello stesso record, con piccole differenze numeriche dichiarate da SemIf.
- Sui 102 casi pubblici di TypeSafe, SemIf dichiara un accordo del 40,7% con Qwen3 0.6B, del 63,7% con MiniCPM5 2B e dell'84,5% con Qwen3.5 4B. Jev pubblica l'88,3%. Sono numeri dichiarati dagli autori, non riprodotti qui.
- Il prompt può arrivare a 4.096 token, senza troncamento: oltre, SemIf rifiuta la domanda e il lab la segna come saltata. Le domande con più di 16 opzioni vengono saltate per lo stesso motivo.

SemIf è un progetto indipendente e non è affiliato a TypeSafe.

Avviate il lab:

```bash
npm start
```

Poi aprite http://127.0.0.1:4317.

## Test automatici

```bash
npm test
```

I test non chiamano Jev e non richiedono una chiave. Le risposte delle fonti pubbliche sono simulate per verificare normalizzazione, separazione delle etichette e calcolo delle medie.

## Snapshot facoltativo

Per scaricare otto record da ciascuna fonte:

```bash
npm run refresh-data
```

Lo snapshot viene salvato in `samples/public-snapshot.json` ed è escluso da Git.

## Privacy

Il server locale:

- ascolta su `127.0.0.1` per default;
- non registra i body delle richieste;
- non salva state o risultati;
- richiede ZDR a Vercel soltanto quando il piano lo supporta; su Hobby usa esclusivamente dati pubblici o sintetici;
- espone la chiave soltanto al backend locale, mai al browser;
- fa girare SemIf in un server Python che ascolta solo su `127.0.0.1` e non registra le richieste.

Nessuna delle due opzioni rende l'elaborazione locale. State e questions transitano comunque attraverso il provider e TypeSafe. Per questo il lab raccomanda dataset pubblici o sintetici.

## Come fare un test sensato

1. Caricate 8-20 record da una fonte.
2. Scegliete un record e lanciate una valutazione singola.
3. Controllate distribuzione e confronto con l'etichetta ufficiale.
4. Ripetete lo stesso state cinque volte.
5. Lanciate il batch e annotate casi sbagliati, incerti e instabili.
6. Cambiate una sola definizione nei `criteria` e ripetete.

Una demo riuscita non prova che il modello sia pronto per la produzione. Il dato interessante è dove sbaglia, con quale sicurezza e quanto il risultato dipende da come avete scritto le categorie.
