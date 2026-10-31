"""Builds public/index.html (the live site) from src/page.html. Run: python build.py"""
import re, pathlib
src = pathlib.Path(__file__).with_name("src") / "page.html"
page = src.read_text(encoding="utf-8")
i = page.index("<header")
head, body = page[:i].strip(), page[i:].strip()
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script>if(location.hostname==="www.thecallective.com")location.replace("https://thecallective.com"+location.pathname+location.search+location.hash)</script>
<link rel="canonical" href="https://thecallective.com/">
<meta property="og:url" content="https://thecallective.com/">
<meta property="og:title" content="The Callective">
<meta property="og:description" content="A community prank call show. Live every Saturday at 7pm Eastern from the World of Prank Calls Discord.">
<meta property="og:image" content="https://thecallective.com/img/og-card.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://thecallective.com/img/og-card.jpg">
{head}
</head>
<body>
{body}
</body>
</html>
"""
# Cache-bust scripts and styles so a new deploy shows up without a hard refresh.
import hashlib
pub = pathlib.Path(__file__).parent / "public"
def bust(m):
    f = pub / m.group(2)
    v = hashlib.md5(f.read_bytes()).hexdigest()[:8] if f.exists() else "0"
    return f'{m.group(1)}{m.group(2)}?v={v}"'
html = re.sub(r'((?:src|href)=")((?:js|css)/[^"?]+)"', bust, html)
(pub / "index.html").write_text(html, encoding="utf-8")
print("built public/index.html")
