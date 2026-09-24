# The Ask assistant

A Cloudflare Worker that answers readers' questions on
[creedsandconfessions.com/ask/](https://creedsandconfessions.com/ask/). Answers come only from
the site's own text, and every section an answer cites links back to it.

## How it answers

1. **Plan.** A model reads the question and proposes likely citations ("WCF 17.1",
   "Heidelberg 1") and search phrases in the documents' own vocabulary.
2. **Retrieve.** The Worker looks those citations up in the site's section index,
   `/assets/search_plus_index.json`. It adds keyword matches and the section the reader came
   from, then keeps up to 10 sections. Citations that don't exist are dropped.
3. **Answer.** A model writes from those sections alone and cites them as `[WCF 17.1]`. The Ask
   page turns a citation into a link only if that section was actually supplied, so an invented
   citation stays plain text.

If a model fails before it has written anything, whether from a limit, a quota or an outage, the
**backup model** takes over. So does a model that stalls: one that hasn't planned within 12
seconds (the backup then writes the answer too), or hasn't started its answer within 15. If the
backup fails too, the page asks the reader to try again soon.

The section index is the one the site's own search uses, and CI validates it. The Worker fetches
the live copy and caches it for an hour, so the assistant always answers from what the site
currently publishes.

## Settings (`wrangler.jsonc`)

| Variable | What it does |
|---|---|
| `MODEL` | Writes the answers. Format: `provider/model-id` |
| `PLAN_MODEL` | Does the planning step. Can be cheaper than `MODEL`, or use a separate free quota |
| `FALLBACK_MODEL` | The backup. Default: `workers-ai/@cf/openai/gpt-oss-120b`, free within Cloudflare's daily allowance |
| `DAILY_LIMIT` | Questions per day for the whole site; after that the page says the assistant is resting until tomorrow (UTC) |
| `DATA_NOTICE` | Shown on the Ask page. **Must match the provider behind `MODEL`** |
| `ALLOWED_ORIGINS` | Sites allowed to call the Worker |
| `CORPUS_URL` | The section index to answer from |

The providers are `google` (Gemini, via `@google/genai`), `fireworks` (via its
OpenAI-compatible Chat Completions API), and `workers-ai` (Cloudflare's AI binding). Adding
another OpenAI-compatible host such as Groq, Together or OpenRouter takes one row in `HOSTS`
in `src/providers/openai-compatible.ts`.

Readers are also limited to 6 questions a minute each (`ratelimits` in `wrangler.jsonc`).

## One-time setup

You'll need three free accounts:

- **Google AI Studio**: create a Gemini API key. Use a Google Cloud project **with billing
  turned off**, which keeps it on the free tier. Turning billing on switches the project to
  paid use.
- **Fireworks** (fireworks.ai): new accounts get $1 of credit, which covers the model test. No
  card is needed until you pick a Fireworks model to run in production.
- **Cloudflare**: keep it on the **Workers Free** plan. Then run:

```bash
cd assistant
npm install
npx wrangler login
cp .dev.vars.example .dev.vars   # then paste your two keys into .dev.vars
npm run models                   # confirms the model IDs your keys can use
```

## The model test

This runs 21 questions through each candidate setup and writes a side-by-side report to
`comparison/`. The questions are in `test/questions.json`. They include two traps: questions
about WCF 23.3 and 25.6, where the site's text differs from the 1646 original, so a model that
answers from memory gets them wrong.

```bash
npm run dev       # terminal 1
npm run compare   # terminal 2; takes about half an hour, paced under the free limits
```

The test costs nothing. Gemini runs on the free tier, Fireworks uses about $0.66 of the $1
credit, and Cloudflare stays within its daily allowance. For a quicker look, run
`npm run compare -- --only gemini-flash,fireworks-kimi --questions pope,magistrate`. To check the
plumbing without touching any provider, run `npm run compare -- --mock`.

For each setup, the report shows:
- how many of the expected citations each answer included
- any citations the Worker didn't supply (possible inventions)
- the median answer time
- the cost per question at the paid price

Read the answers themselves too. The numbers can't tell whether an answer is faithful.

## Going live

1. Set `MODEL`, `PLAN_MODEL` and `DATA_NOTICE` in `wrangler.jsonc` for the model you chose.
   - **Gemini free tier** (the current setting): `MODEL` and `PLAN_MODEL` both
     `google/gemini-3.5-flash-lite`. Keep the default notice, which says Google may use and read
     the questions. Gemini 3.8 Flash failed the model test: it hit Google's "high demand"
     errors, then ran out of free quota within a day.
   - **A Fireworks model:** `MODEL: fireworks/accounts/fireworks/models/<id>`. Add a card at
     fireworks.ai and set a **monthly spend limit** (for example $5); when it's reached,
     Fireworks pauses requests and the backup answers. Change `DATA_NOTICE` to something like
     "Questions are answered by <model> via Fireworks AI, which doesn't store them. Please
     don't include personal details."
2. Deploy, then store the chosen provider's key in the deployed Worker. Until the key is stored,
   every answer comes from the backup.

```bash
npm run deploy
npx wrangler secret put GEMINI_API_KEY      # or FIREWORKS_API_KEY; paste the key when asked
```

3. Put the URL that the deploy printed (`https://creeds-assistant.<you>.workers.dev`) in
   `assistant_url` in the site's `_config.yml`, and push. Until `assistant_url` is set, the site
   shows no assistant controls.

## Local development

`npm run dev` runs the Worker at `http://127.0.0.1:8787`. It needs `wrangler login`, because the
backup model always runs on Cloudflare. To run the site against it:

```bash
bundle exec jekyll serve --config _config.yml,_config.dev.yml   # from the repository root
```

To work on the Ask page without keys or a Cloudflare login, use the stand-in models, which exist
only when `ALLOW_MODEL_OVERRIDE=true`:

```bash
npx wrangler dev --local --var MODEL:mock/echo --var PLAN_MODEL:mock/echo --var FALLBACK_MODEL:mock/echo
```

`mock/echo` answers by citing the sections it was given. `mock/fail` fails like a provider at
its limit, and `mock/hang` never replies, like a stalled provider; both show the backup taking
over.

Checks, which CI also runs after building the site:

```bash
npm run check   # regenerates worker-configuration.d.ts, then type-checks
npm test        # citation lookup and search, against ../_site (build the site first)
```

## Staying at the planned cost

- Keep Workers on the **Free** plan. On Free, the backup stops at Cloudflare's daily allowance
  (10,000 Neurons, about 25–30 answers) instead of billing; Workers Paid would bill beyond it.
- **Don't turn on billing** for the Google project behind the Gemini key.
- If you use Fireworks, **set its monthly spend limit**.
- Keep `DAILY_LIMIT` on. It caps the whole site, whatever the provider does.

The Worker logs each question's models, token counts, section count, timing and any failures,
but never the question text. See them under Workers → creeds-assistant → Logs in the Cloudflare
dashboard.

## Privacy

Questions go to whichever provider runs `MODEL`, and the Ask page says which one:

- **Gemini free tier:** Google may use prompts and responses to improve its products, and people
  at Google may read them.
- **Fireworks:** no prompts or answers are stored for open models.
- **Cloudflare Workers AI:** runs the backup.
