# Moving SOKREN to Claude Code — do this once

## 1. Get the repo onto your Mac
Open Terminal:
```
cd ~/Documents
git clone https://github.com/sokrenglobalops/sokrenintel.git
cd sokrenintel
```
(If git asks who you are: `git config --global user.name "Timothy Rios"` and `git config --global user.email "<your GitHub email>"`.
If a push asks for a password, GitHub wants a Personal Access Token, not your login password: GitHub → Settings →
Developer settings → Personal access tokens → Fine-grained → repo `sokrenintel`, Contents: read/write.)

## 2. Drop this handoff into the repo
Unzip `sokren-handoff.zip` and copy everything in it into the `sokrenintel` folder, replacing what's there
(`index.html`, `README.md`) and adding `CLAUDE.md`, `package.json`, `.gitignore`, `tests/`, `sokren-relay/`.
Leave `cables.json` in place.

## 3. Install the test tools (one time)
```
npm install
npx playwright install chromium
npm test
```
You should see PASS on every line and "all green".

## 4. Start Claude Code in the repo
Either the **Code** tab in the Claude desktop app (open the `sokrenintel` folder), or in Terminal:
```
npm install -g @anthropic-ai/claude-code
claude
```
It reads `CLAUDE.md` automatically. Paste the first prompt below.

## 5. First prompt to paste
> Read CLAUDE.md, then: (1) run `npm test` and confirm it's green; (2) commit the handoff files with the
> message "Add CLAUDE.md, tests, relay project"; push to main; (3) deploy the relay from `sokren-relay/`
> following its README — run `npm install`, `npx wrangler login` (I'll approve in the browser),
> `npx wrangler secret put AISSTREAM_KEY` (I'll paste the key when prompted), `npx wrangler deploy`;
> (4) put the deployed URL into `RELAY_BASE` in index.html, run `npm test` again, commit "Point site at
> relay", push; (5) tell me what to check on www.sokren.com.

After that, work item by item: "add X", "fix Y". It will edit, test, commit and push; you hard-refresh the site.

## Everyday commands (for you, not Claude)
```
cd ~/Documents/sokrenintel
git pull            # get anything pushed from elsewhere
npm test            # run the checks yourself
git log --oneline   # what changed, newest first
```
