# Deploy the site on GitHub Pages

The website is the `docs/` folder (pure static HTML/JS, no build). GitHub Pages can serve it directly.

## Option A — Phone / browser only (no git)
1. github.com → **New repository** → name it `personal-mcp-assistant` → Public → Create.
2. Unzip the master zip on your phone/PC.
3. In the repo: **Add file → Upload files** → upload the *contents* of the unzipped folder (keep the `docs/` folder structure; `docs/.nojekyll` is a hidden file — if your uploader skips it, it's optional).
   Tip: uploading folders works from desktop browsers; on mobile use Option B.
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / folder: `/docs` → Save.**
5. Wait ~1 minute. Your site: `https://Nikhil-creat.github.io/personal-mcp-assistant/`

## Option B — Termux (like your other projects)
```bash
pkg install git unzip -y
cd ~ && unzip /sdcard/Download/personal-mcp-assistant.zip && cd personal-mcp-assistant
git init && git branch -M main
git add . && git commit -m "Personal MCP Assistant"
git remote add origin https://github.com/Nikhil-creat/personal-mcp-assistant.git
git push -u origin main        # use a Personal Access Token as the password
```
Then do step 4 above.

## Updating later
Edit files → `git add . && git commit -m "update" && git push`. Pages redeploys automatically.

## Using it
Open the site → **Settings** → paste your Groq key (console.groq.com → API Keys) → **Load demo data** → ask a question.
Optional: run `docker compose up --build` locally and put `http://localhost:4000` in "Backend API URL".
(A site on HTTPS cannot call an `http://` backend from most browsers except localhost; deploy the backend behind HTTPS for remote use.)
