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
<meta property="og:title" content="The Callective">
<meta property="og:description" content="A community prank call show. Live every Saturday at 7pm Eastern from the World of Prank Calls Discord.">
<meta property="og:image" content="img/stage.webp">
{head}
</head>
<body>
{body}
</body>
</html>
"""
(pathlib.Path(__file__).parent / "public" / "index.html").write_text(html, encoding="utf-8")
print("built public/index.html")
