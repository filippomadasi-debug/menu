# Ricettario

App web statica per registrare pranzi e cene (adulto + bimbo), con recap mensile
e archivio ricette taggate **per bimbi / per adulti / entrambi**.

- Frontend: HTML/CSS/JS puro, nessun build step → si pubblica su GitHub Pages
- Database: Supabase (Postgres), raggiunto dal browser con URL progetto + chiave `anon`

## File

| File | Cosa contiene |
|---|---|
| `index.html` | struttura delle tre pagine (Recap, Ricette, Impostazioni) |
| `styles.css` | stile, tema chiaro/scuro automatico, layout responsive |
| `app.js` | logica: caricamento dati, calendario, statistiche, CRUD ricette |
| `supabase-schema.sql` | **da eseguire su Supabase**: tabelle, indici, RLS, policy |
| `config.js` | opzionale, tutto commentato: credenziali precompilate (vedi Sicurezza) |

## 1. Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) (piano free).
2. **SQL Editor → New query** → incolla tutto `supabase-schema.sql` → **Run**.
   In fondo vedi il conteggio righe delle tre tabelle: `categories 14`, `recipes 0`, `meals 0`.
3. Recupera le due credenziali (la dashboard le tiene in due punti diversi):
   - **Project URL** → *Project Settings* → **Integrations → Data API** (formato `https://xxxx.supabase.co`).
     Si ricava anche dall'indirizzo della dashboard: `supabase.com/dashboard/project/<ref>`
     → l'URL è `https://<ref>.supabase.co`.
   - **Chiave pubblica** → *Project Settings* → **API Keys**: va bene sia la nuova
     *publishable key* (`sb_publishable_...`) sia la *legacy anon key* (`eyJ...`).
     Non usare mai `service_role` né una *secret key*: bypassano la RLS.

## 2. GitHub Pages

```bash
git init
git add .
git commit -m "Ricettario: app pranzi e cene"
git branch -M main
git remote add origin https://github.com/<utente>/ricettario.git
git push -u origin main
```

Poi su GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`**.
Dopo circa un minuto l'app è su `https://<utente>.github.io/ricettario/`.

## 3. Prima configurazione

Apri l'app → **Impostazioni** → incolla Project URL e chiave anon → *Salva e connetti*.
Le credenziali restano nel `localStorage` di quel browser (da rifare su ogni dispositivo).

In alternativa: apri `config.js`, togli il commento alle tre righe finali e compila i due
valori — l'app si connette da sola su qualsiasi dispositivo. Fallo **solo con repo privato**:
in un repo pubblico la chiave sarebbe leggibile da tutti.

## Come si usa

**Recap mensile** — frecce `‹ ›` per cambiare mese.

- 4 KPI: pasti registrati sul totale teorico (giorni × 2 pasti × 2 persone), copertura %,
  piatti diversi, varietà (piatti diversi / pasti registrati)
- *Piatti più frequenti* e *Mix per categoria*: barre con la quota adulto (blu) e bimbo (giallo)
- *Ripetizioni del mese*: solo i piatti usati più di una volta, con il conteggio
- *Calendario*: una riga per giorno, quattro slot (pranzo/cena × adulto/bimbo).
  Clic su uno slot → cerca il piatto → assegnato. *Svuota lo slot* lo azzera.
  Il picker mostra solo le ricette compatibili: allo slot del bimbo arrivano
  le ricette taggate «Per bimbi» o «Entrambi».
- *Contorni*: sulla **cena dell'adulto** lo slot ha una seconda riga `+ contorno…`.
  Cliccandola si apre il picker sulla tab **Contorno**, che elenca solo le ricette
  con la spunta «È un contorno». Il contorno si aggancia a un pasto esistente:
  prima il piatto principale, poi il contorno. Cambiare il piatto principale
  non perde il contorno; *Svuota lo slot* rimuove entrambi.
  Per abilitare i contorni su altri slot, aggiungi una voce a `SIDE_SLOTS`
  in cima a `app.js`, es. `{ slot: 'pranzo', eater: 'adulto' }`.
- *Contorni usati*: card con il conteggio del mese, visibile solo se ne hai registrati.

**Settimana** — la settimana corrente (lunedì → domenica), con il giorno di oggi
evidenziato dal badge «oggi» e dal bordo colorato. Sopra, quattro numeri: pasti
pianificati sui 28 possibili, copertura, slot ancora da riempire da oggi in avanti
e contorni previsti. Gli slot si compilano esattamente come nel calendario mensile
e le due viste restano sempre allineate. Frecce `‹ ›` per spostarsi di settimana,
*Questa settimana* per tornare a quella in corso.

**Ricette** — form a sinistra (nome, per chi, categoria, minuti, «è un contorno»,
ingredienti, note), archivio a destra con ricerca e filtri per tag, tipo
(piatti / contorni) e categoria, modifica ed eliminazione.
Nomi duplicati sono bloccati dal database (confronto case-insensitive).

## Modello dati

```
categories(name, sort_order)                     → tendina categorie
recipes(id, name, target, category, prep_minutes,
        is_side, ingredients, notes,              → target: bimbo | adulti | entrambi
        is_archived, ...)                           is_side: selezionabile come contorno
meals(id, meal_date, slot, eater, recipe_id,     → slot: pranzo | cena
      side_recipe_id)                               eater: adulto | bimbo
                                                    UNIQUE(meal_date, slot, eater)
```

Il vincolo `UNIQUE` garantisce un solo piatto per slot: riassegnare sovrascrive,
non duplica. `meals.recipe_id` ha `ON DELETE CASCADE`: eliminando una ricetta
spariscono anche i pasti in cui compariva (l'app avvisa prima).
`meals.side_recipe_id` ha invece `ON DELETE SET NULL`: eliminando un contorno
il pasto resta, senza accompagnamento.

Lo script è rilanciabile: le colonne `is_side` e `side_recipe_id` sono aggiunte
con `alter table ... add column if not exists`, quindi puoi eseguire di nuovo
`supabase-schema.sql` anche su un database creato con la versione precedente.

## Sicurezza

Le policy RLS dello schema danno **lettura e scrittura al ruolo `anon`**: chiunque abbia
URL e chiave anon può modificare i dati. Va bene per un ricettario di famiglia, a patto
che la chiave non finisca in un repo pubblico.

Tre livelli, dal più semplice:

1. Repo pubblico, `config.js` lasciato commentato e chiave inserita a mano in Impostazioni
   → la chiave non finisce mai nel repo.
2. Repo privato con `config.js` compilato → comodo, la chiave resta privata
   (GitHub Pages su repo privato richiede un piano a pagamento).
3. Login vero: attiva Supabase Auth e sostituisci le policy con la **variante protetta**
   in fondo a `supabase-schema.sql` (richiede di aggiungere una schermata di login all'app).

## Aggiungere categorie

```sql
insert into public.categories (name, sort_order) values ('Street food', 140);
```

Compare subito nella tendina al successivo caricamento della pagina.
