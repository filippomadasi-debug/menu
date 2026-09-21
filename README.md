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
3. **Project Settings → API**, copia:
   - *Project URL* → `https://xxxx.supabase.co`
   - *Project API keys → anon public*

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

**Ricette** — form a sinistra (nome, per chi, categoria, minuti, ingredienti, note),
archivio a destra con ricerca e filtri per tag e categoria, modifica ed eliminazione.
Nomi duplicati sono bloccati dal database (confronto case-insensitive).

## Modello dati

```
categories(name, sort_order)                     → tendina categorie
recipes(id, name, target, category, prep_minutes,
        ingredients, notes, is_archived, ...)    → target: bimbo | adulti | entrambi
meals(id, meal_date, slot, eater, recipe_id)     → slot: pranzo | cena
                                                    eater: adulto | bimbo
                                                    UNIQUE(meal_date, slot, eater)
```

Il vincolo `UNIQUE` garantisce un solo piatto per slot: riassegnare sovrascrive,
non duplica. `meals.recipe_id` ha `ON DELETE CASCADE`: eliminando una ricetta
spariscono anche i pasti in cui compariva (l'app avvisa prima).

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
