# Share card

`og-card.html` is the source of `public/og.png` (1200x630), the image link previews show for sage.agentcamp.xyz. It reuses the hero art (`/sage-hero.svg`) and the landing colors. To change the card: edit `og-card.html`, run `pnpm dev`, open `http://localhost:5180/og/og-card.html` in a browser at a 1200x630 viewport, screenshot the viewport, and save it over `public/og.png`. The meta tags in `index.html` point at `https://sage.agentcamp.xyz/og.png`. Some apps cache previews: after a change, refresh them in each platform's card or debug tool.
