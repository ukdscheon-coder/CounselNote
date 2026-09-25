#!/usr/bin/env python3
"""Build static content pages for counselnote.uk.

Usage:  python3 tools/build_site.py
Needs:  pip install markdown

- content/guides/*.md  -> website/guides/<slug>.html  + website/guides/index.html
- content/pages/*.md   -> website/<slug>.html   (about, contact, terms)
- Injects the shared <head> tags (Google Analytics, AdSense) into every page
- Writes website/sitemap.xml and website/robots.txt

Ad policy: the AdSense script is loaded ONLY on content pages (guides, home,
product guide, FAQ, about). It is never loaded on checkout, download,
payment-result, privacy, terms or contact pages, so ads never appear on
screens without publisher content.
"""
import datetime
import html
import json
import pathlib
import re

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "website"
SITE = "https://counselnote.uk"
GA_ID = "G-91LT88R0F4"
ADS_CLIENT = "ca-pub-9335333067725848"
TODAY = datetime.date.today()
REVIEWED = TODAY.strftime("%-d %B %Y")

AD_PAGES = {"index.html", "guide.html", "faq.html", "about.html"}  # plus everything in guides/

GA_BLOCK = f"""<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('consent', 'default', {{ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500}});
  gtag('js', new Date());
  gtag('config', '{GA_ID}');
</script>
<meta name="google-adsense-account" content="{ADS_CLIENT}">"""
ADS_BLOCK = f"""<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={ADS_CLIENT}" crossorigin="anonymous"></script>"""
MARK_START, MARK_END = "<!-- cn:head -->", "<!-- /cn:head -->"


def nav(prefix=""):
    return f"""<header class="site-header">
  <div class="nav-wrap">
    <a class="brand" href="{prefix}index.html"><span class="mark">CN</span><strong>CounselNote</strong></a>
    <nav class="links">
      <a href="{prefix}index.html#features">Features</a>
      <a href="{prefix}index.html#pricing">Pricing</a>
      <a href="{prefix}guides/">Guides</a>
      <a href="{prefix}guide.html">How it works</a>
      <a href="{prefix}faq.html">FAQ</a>
      <a class="cta" href="{prefix}download.html">Try free</a>
    </nav>
  </div>
</header>"""


def footer(prefix=""):
    return f"""<footer class="site-footer">
  <div class="footer-wrap">
    <div class="col">
      <strong style="color:#fff;display:block;margin-bottom:6px">CounselNote</strong>
      Secure, local-first counselling records<br>for UK schools.
    </div>
    <div class="col">
      <strong style="color:#fff;display:block;margin-bottom:6px">Product</strong>
      <a href="{prefix}download.html">Download</a><br>
      <a href="{prefix}checkout.html">Pricing &amp; buy</a><br>
      <a href="{prefix}guide.html">How it works</a><br>
      <a href="{prefix}faq.html">FAQ</a>
    </div>
    <div class="col">
      <strong style="color:#fff;display:block;margin-bottom:6px">Guides</strong>
      <a href="{prefix}guides/how-to-write-school-counselling-session-notes.html">Writing session notes</a><br>
      <a href="{prefix}guides/how-long-should-schools-keep-counselling-records.html">Record retention</a><br>
      <a href="{prefix}guides/sharing-information-with-the-designated-safeguarding-lead.html">Sharing with the DSL</a><br>
      <a href="{prefix}guides/">All guides</a>
    </div>
    <div class="col">
      <strong style="color:#fff;display:block;margin-bottom:6px">Company</strong>
      <a href="{prefix}about.html">About</a><br>
      <a href="{prefix}contact.html">Contact</a><br>
      <a href="{prefix}privacy.html">Privacy notice</a><br>
      <a href="{prefix}terms.html">Terms</a>
    </div>
  </div>
  <p class="footer-note">CounselNote stores all pupil and session data only on your own computer. CounselNote is a private counselling workspace and does not replace your school's statutory child-protection system. Guides on this site are general information, not legal advice.</p>
</footer>"""


ARTICLE_CSS = """<style>
  .crumbs{font-size:13px;color:var(--muted);padding-top:28px}
  .crumbs a{color:var(--muted)}
  article.guide{max-width:760px;margin:0 auto;padding-bottom:30px}
  article.guide h1{font-size:34px;line-height:1.2;margin:14px 0 10px}
  article.guide .meta{color:var(--muted);font-size:13px;margin-bottom:26px}
  article.guide .lede{font-size:17px;color:#3a544f}
  article.guide h2{font-size:23px;margin:34px 0 10px}
  article.guide h3{font-size:18px;margin:22px 0 8px}
  article.guide p,article.guide li{font-size:16px;line-height:1.75;color:#2d4541}
  article.guide ul,article.guide ol{padding-left:22px}
  article.guide li{margin-bottom:6px}
  article.guide blockquote{margin:18px 0;padding:14px 18px;border-left:4px solid var(--teal);background:var(--mint);border-radius:0 10px 10px 0}
  article.guide blockquote p{margin:0}
  article.guide table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;display:block;overflow-x:auto}
  article.guide th,article.guide td{border:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top}
  article.guide th{background:var(--mint);color:#1f504b}
  article.guide pre{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px;overflow-x:auto;font-size:13.5px;line-height:1.6}
  .disclaimer{background:#fff7e8;border:1px solid #f1d9a0;border-radius:12px;padding:14px 18px;color:#6b4f17;font-size:14px;margin:28px 0}
  .related{border-top:1px solid var(--line);margin-top:34px;padding-top:18px}
  .related h2{font-size:19px!important}
  .guide-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;margin:10px 0 30px}
  .guide-list a.card{text-decoration:none;color:inherit;display:block}
  .guide-list a.card:hover{border-color:var(--teal)}
  .guide-list h2{font-size:18px;margin-bottom:6px;color:var(--deep)}
  .guide-list p{margin:0;color:var(--muted);font-size:14px;line-height:1.6}
  @media (max-width:700px){article.guide h1{font-size:27px} nav.links{gap:12px;flex-wrap:wrap}}
</style>"""


def head(title, desc, canonical, ads, extra=""):
    return f"""<!doctype html>
<html lang="en-GB">
<head>
{MARK_START}
{GA_BLOCK}
{ADS_BLOCK if ads else ''}
{MARK_END}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:site_name" content="CounselNote">
{extra}"""


def parse_md(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    meta = dict(line.split(": ", 1) for line in m.group(1).splitlines())
    return meta, m.group(2).strip()


def md_to_html(body):
    return markdown.markdown(body, extensions=["tables", "fenced_code"])


def build_guides():
    out = WEB / "guides"
    out.mkdir(exist_ok=True)
    guides = []
    for p in sorted((ROOT / "content" / "guides").glob("*.md")):
        meta, body = parse_md(p)
        guides.append((p.stem, meta, body))

    for slug, meta, body in guides:
        url = f"{SITE}/guides/{slug}"
        first_para, rest = body.split("\n\n", 1)
        others = [g for g in guides if g[0] != slug][:3]
        related = "".join(
            f'<li><a href="{s}.html">{html.escape(m["title"])}</a></li>' for s, m, _ in others
        )
        ld = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": meta["title"],
            "description": meta["description"],
            "inLanguage": "en-GB",
            "dateModified": TODAY.isoformat(),
            "mainEntityOfPage": url,
            "author": {"@type": "Organization", "name": "CounselNote", "url": SITE},
            "publisher": {"@type": "Organization", "name": "CounselNote", "url": SITE},
        }
        crumbs_ld = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "CounselNote", "item": SITE + "/"},
                {"@type": "ListItem", "position": 2, "name": "Guides", "item": SITE + "/guides/"},
                {"@type": "ListItem", "position": 3, "name": meta["title"], "item": url},
            ],
        }
        extra = (
            ARTICLE_CSS
            + f'\n<script type="application/ld+json">{json.dumps(ld)}</script>'
            + f'\n<script type="application/ld+json">{json.dumps(crumbs_ld)}</script>'
        )
        page = (
            head(meta["title"] + " | CounselNote", meta["description"], url, True, extra)
            + '<link rel="stylesheet" href="../styles.css">\n</head>\n<body>\n\n'
            + nav("../")
            + f"""
<main>
  <p class="crumbs"><a href="../index.html">CounselNote</a> › <a href="./">Guides</a></p>
  <article class="guide">
    <h1>{html.escape(meta['title'])}</h1>
    <p class="meta">By the CounselNote team · Last reviewed {REVIEWED}</p>
    <div class="lede">{md_to_html(first_para)}</div>
    {md_to_html(rest)}
    <p class="disclaimer">This guide is general information for school counsellors and pastoral staff in the UK. It is not legal advice. Always follow your school's safeguarding, data protection and records policies, and take advice from your DSL, DPO or supervisor on individual cases.</p>
    <nav class="related"><h2>Related guides</h2><ul>{related}</ul></nav>
  </article>
</main>

"""
            + footer("../")
            + "\n</body>\n</html>\n"
        )
        (out / f"{slug}.html").write_text(page, encoding="utf-8")

    cards = "".join(
        f'<a class="card" href="{s}.html"><h2>{html.escape(m["title"])}</h2><p>{html.escape(m["short"])}</p></a>'
        for s, m, _ in guides
    )
    desc = "Free practical guides for UK school counsellors and pastoral teams: session notes, record retention, confidentiality, DSL referrals, subject access requests, consent, outcome measures and UK GDPR."
    index = (
        head("Guides for UK school counsellors | CounselNote", desc, SITE + "/guides/", True, ARTICLE_CSS)
        + '<link rel="stylesheet" href="../styles.css">\n</head>\n<body>\n\n'
        + nav("../")
        + f"""
<main>
  <div class="page-head">
    <h1>Guides for UK school counsellors</h1>
    <p>Practical, source-linked guidance on the record-keeping, safeguarding and data protection questions school counsellors and pastoral teams deal with every week.</p>
  </div>
  <div class="guide-list">{cards}</div>
  <p class="disclaimer">These guides are general information, not legal advice. They link to the official DfE, ICO, BACP and legislation sources they draw on — always check the current version of those sources and your school's own policies.</p>
</main>

"""
        + footer("../")
        + "\n</body>\n</html>\n"
    )
    (out / "index.html").write_text(index, encoding="utf-8")
    return [f"guides/{s}" for s, _, _ in guides]


def build_pages():
    slugs = []
    for p in sorted((ROOT / "content" / "pages").glob("*.md")):
        meta, body = parse_md(p)
        slug = p.stem
        page = (
            head(meta["title"], meta["description"], f"{SITE}/{slug}", slug + ".html" in AD_PAGES, ARTICLE_CSS)
            + '<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n\n'
            + nav()
            + f"""
<main>
  <article class="guide" style="padding-top:40px">
    <h1>{html.escape(meta['heading'])}</h1>
    {md_to_html(body)}
  </article>
</main>

"""
            + footer()
            + "\n</body>\n</html>\n"
        )
        (WEB / f"{slug}.html").write_text(page, encoding="utf-8")
        slugs.append(slug)
    return slugs


def update_existing_pages():
    """Refresh shared head tags, header and footer on the hand-written pages."""
    for p in WEB.glob("*.html"):
        s = p.read_text(encoding="utf-8")
        if MARK_START in s:
            s = re.sub(re.escape(MARK_START) + r".*?" + re.escape(MARK_END) + r"\n?", "", s, flags=re.S)
        ads = p.name in AD_PAGES
        block = f"{MARK_START}\n{GA_BLOCK}\n{ADS_BLOCK if ads else ''}\n{MARK_END}\n"
        s = s.replace("<head>\n", "<head>\n" + block, 1)
        if p.name.startswith("checkout"):
            p.write_text(s, encoding="utf-8")  # checkout keeps its own minimal chrome
            continue
        s = re.sub(r'<header class="site-header">.*?</header>', nav(), s, count=1, flags=re.S)
        s = re.sub(r'<footer class="site-footer">.*?</footer>', footer(), s, count=1, flags=re.S)
        if 'rel="canonical"' not in s:
            path = "" if p.name == "index.html" else p.stem
            s = s.replace("</title>", f'</title>\n<link rel="canonical" href="{SITE}/{path}">', 1)
        p.write_text(s, encoding="utf-8")


def write_sitemap(guide_urls, page_slugs):
    urls = ["", "guides/", "guide", "faq", "download", "checkout", "privacy"] + page_slugs + guide_urls
    items = "\n".join(
        f"  <url><loc>{SITE}/{u}</loc><lastmod>{TODAY.isoformat()}</lastmod></url>" for u in dict.fromkeys(urls)
    )
    (WEB / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{items}\n</urlset>\n',
        encoding="utf-8",
    )
    (WEB / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8"
    )


if __name__ == "__main__":
    g = build_guides()
    pages = build_pages()
    update_existing_pages()
    write_sitemap(g, pages)
    print(f"built {len(g)} guides, pages: {pages}")
