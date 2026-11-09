#!/usr/bin/env python3
"""公開前のチェック（記録が消えないか）

今の形の記録が、新しい版のアプリでもそのまま読めて、保存しても壊れないことを確かめます。
公開（git push）の前に、毎回これを通してください。

  python3 dev/check.py

必要なもの: Python の playwright と Chromium（`pip install playwright` → `playwright install chromium`）
"""
import datetime
import json
import pathlib
import re
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / 'dev/fixtures/data-v1.json').read_text(encoding='utf-8')
DATA_KEY = 'sns-kirokucho.data.v1'
APP = (ROOT / 'app.js').read_text(encoding='utf-8')
m = re.search(r'const DATA_VERSION = (\d+);', APP)
DATA_VERSION = int(m.group(1)) if m else None
FAILS = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def storage(pg):
    return pg.evaluate('() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }')


def main():
    check(DATA_VERSION is not None, 'app.js に DATA_VERSION がある')
    check(f"const DATA_KEY = '{DATA_KEY}';" in APP, f'保存の名前が {DATA_KEY} のまま')
    check('localStorage.clear' not in APP, 'localStorage.clear() を使っていない（同じアドレスの他アプリを消さない）')
    published = [f for f in ROOT.rglob('*') if f.is_file() and '.git' not in f.parts and 'dev' not in f.relative_to(ROOT).parts
                 and f.suffix in ('.html', '.js', '.json', '.webmanifest', '.md', '.txt')]
    token_re = re.compile(r'github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}')
    leaks = [str(f.relative_to(ROOT)) for f in published if token_re.search(f.read_text(encoding='utf-8', errors='ignore'))]
    check(not leaks, '公開するファイルに鍵が入っていない' + (f': {leaks}' if leaks else ''))
    code = {n: (ROOT / n).read_text(encoding='utf-8') for n in ('app.js', 'index.html', 'ocr-parse.js', 'sw.js')}
    named = [n for n, t in code.items() if re.search(r'flawy0025/(?!sns-kirokucho)', t) or re.search(r'id="gh-repo"[^>]*\svalue=', t)]
    check(not named, 'アプリのファイルに、つなぐ先のリポジトリが書かれていない' + (f': {named}' if named else ''))

    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/'
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            errors = []

            gh_calls = []
            all_reqs = []

            def no_github(route):
                gh_calls.append(route.request.url)
                route.abort()

            def page(seed, gh=None):
                ctx = browser.new_context(viewport={'width': 400, 'height': 860}, accept_downloads=True, service_workers='block')
                ctx.route(re.compile(r'https://(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)/.*'), lambda r: r.abort())
                ctx.route('https://api.github.com/**', gh or no_github)
                pg = ctx.new_page()
                pg.on('pageerror', lambda e: errors.append(str(e)))
                pg.on('request', lambda r: all_reqs.append((r.url, r.headers.get('authorization'))))
                pg.goto(url)
                pg.evaluate('(seed) => { localStorage.clear(); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }', seed)
                pg.reload(); pg.wait_for_timeout(500)
                return ctx, pg

            def add_page(pg, followers='321'):
                pg.click('#open-entry'); pg.wait_for_timeout(250)
                pg.fill('#f-x-followers', followers)
                pg.click('#f-save'); pg.wait_for_timeout(350)

            fx = json.loads(FIXTURE)
            dates = sorted(fx['records'])

            print('1. 今の形の記録を読み込んで、1ページ直す')
            ctx, pg = page({DATA_KEY: FIXTURE, 'other-app.data': 'keep-me'})
            check(pg.is_hidden('#banner'), 'お知らせ（警告）が出ない')
            check(pg.text_content('#rec-count').strip() == f'{len(dates)} ページ', f'{len(dates)} ページすべて表示される')
            if DATA_VERSION == 1:
                pg.click('#rec-body tr.edit'); pg.wait_for_timeout(250)
                check(pg.input_value('#f-date') == dates[-1], 'いちばん新しいページが開く')
                pg.fill('#f-x-followers', '999')
                pg.click('#f-save'); pg.wait_for_timeout(350)
                st = storage(pg)
                saved = json.loads(st[DATA_KEY])
                same = all(saved['records'][d] == fx['records'][d] for d in dates[:-1])
                check(same, '直していないページは1文字も変わらない')
                last, before = saved['records'][dates[-1]], fx['records'][dates[-1]]
                check(last['x']['followers'] == 999, '直した数字が保存される')
                check(last['x'].get('bookmarks') == before['x'].get('bookmarks') and last.get('tags') == before.get('tags'), '知らない項目も消えずに残る')
                check(last['note'] == before['note'], '使っていない媒体（note）の数字も残る')
                check(saved['settings'] == fx['settings'] and saved.get('futureTopLevel') == fx['futureTopLevel'], '設定やその他の項目も残る')
                check(st.get('other-app.data') == 'keep-me', '同じアドレスの他アプリの保存に触れない')
                check(not any(k.startswith(('sns-kirokucho.backup.', 'sns-kirokucho.rescue.')) for k in st), '余計な控えを作らない')
            ctx.close()

            print('2. 壊れた記録（途中で切れた文字）')
            broken = FIXTURE[: len(FIXTURE) // 2]
            ctx, pg = page({DATA_KEY: broken})
            st = storage(pg)
            rescues = [k for k in st if k.startswith('sns-kirokucho.rescue.')]
            check(len(rescues) == 1 and st[rescues[0]] == broken, '消さずに、そのままの中身で控えを取る')
            check(pg.is_visible('#banner') and '控え' in pg.text_content('#banner-text'), '控えを取ったことを知らせる')
            with pg.expect_download() as dl:
                pg.click('#banner-act')
            check(pathlib.Path(dl.value.path()).read_text(encoding='utf-8') == broken, '控えをファイルに書き出せる（中身がそのまま）')
            add_page(pg)
            st = storage(pg)
            check(len(json.loads(st[DATA_KEY])['records']) == 1, '新しいページは書ける')
            check(st.get(rescues[0]) == broken and len([k for k in st if k.startswith('sns-kirokucho.rescue.')]) == 1, '書いたあとも控えはそのまま')
            ctx.close()

            print('3. 形の違う記録（records が配列）')
            odd = json.dumps({'version': 1, 'records': [fx['records'][dates[0]]]})
            ctx, pg = page({DATA_KEY: odd})
            st = storage(pg)
            check(any(k.startswith('sns-kirokucho.rescue.') and v == odd for k, v in st.items()), '控えを取る')
            ctx.close()

            print('4. 新しい版のアプリが書いた記録（古い版で開いた場合）')
            newer = json.dumps({**fx, 'version': (DATA_VERSION or 1) + 98})
            ctx, pg = page({DATA_KEY: newer})
            check(pg.is_visible('#banner') and '新しい版' in pg.text_content('#banner-text'), '保存を止めたことを知らせる')
            pg.click('#open-entry'); pg.wait_for_timeout(250)
            pg.fill('#f-x-followers', '5'); pg.click('#f-save'); pg.wait_for_timeout(300)
            check('保存を止めています' in pg.text_content('#form-err'), '保存しようとしても理由を伝える')
            check(storage(pg)[DATA_KEY] == newer, '新しい版の記録を上書きしない')
            ctx.close()

            print('5. 記録の形を変えた版（DATA_VERSION が 2 以上のとき）')
            if DATA_VERSION and DATA_VERSION > 1:
                ctx, pg = page({DATA_KEY: FIXTURE})
                st = storage(pg)
                check(any(k.startswith('sns-kirokucho.backup.v1.') and v == FIXTURE for k, v in st.items()), '変換の前に、元の記録を控える')
                saved = json.loads(st[DATA_KEY])
                check(saved['version'] == DATA_VERSION, f'版が {DATA_VERSION} になる')
                check(sorted(saved['records']) == dates, 'すべての日付が残る')
                check(pg.text_content('#rec-count').strip() == f'{len(dates)} ページ', 'すべて表示される')
                ctx.close()
            else:
                print('  skip いまは版 1 のまま（変換なし）')

            print('6. 「すべての記録を消す」')
            ctx, pg = page({DATA_KEY: FIXTURE, 'sns-kirokucho.rescue.x': 'old', 'sns-kirokucho.theme': 'mist', 'other-app.data': 'keep-me'})
            pg.click('#wipe'); pg.click('#wipe'); pg.wait_for_timeout(300)
            st = storage(pg)
            check(json.loads(st[DATA_KEY])['records'] == {}, '記録が消える')
            check('sns-kirokucho.rescue.x' not in st, '控えも消える')
            check(st.get('sns-kirokucho.theme') == 'mist' and st.get('other-app.data') == 'keep-me', '色の設定と他アプリの保存は残る')
            ctx.close()

            check(not gh_calls, 'つないでいないときは GitHub に問い合わせない')

            print('7. 自動取得とつなぐ（試験用の GitHub）')
            TOKEN = 'github_pat_TEST' + 'x' * 40
            REPO = 'test-user/stats-repo'
            t0 = datetime.date.today()
            ds = [(t0 - datetime.timedelta(days=i)).isoformat() for i in range(10, 0, -1)]
            def jst(d, days, hm):
                return (datetime.datetime.fromisoformat(d) + datetime.timedelta(days=days, hours=int(hm[:2]) - 9, minutes=int(hm[3:]))).isoformat() + 'Z'
            remote = {}
            for k, d in enumerate(ds):
                remote[d] = {'date': d, 'x': {'followers': 100 + k, 'impressions': 1000 + k, 'posts': 3, 'engagement': 9},
                             'threads': {'followers': 50 + k, 'impressions': 500 + k, 'posts': 2, 'engagement': 4, 'post_views': 7},
                             'note': {'followers': None, 'pv': None, 'impressions': None, 'likes': None},
                             'memo': '', 'fetchedAt': jst(d, 1, '06:10'), 'state': {'x': 'ok', 'threads': 'expired'}}
            late = ds[2]
            remote[late]['fetchedAt'] = jst(late, 4, '20:00')  # 後から取り直した日
            files = {'data/index.json': {'updatedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'latest': ds[-1], 'dates': ds},
                     'data/health.json': {'x': {'state': 'ok'}, 'threads': {'state': 'expired', 'message': '（試験）'}, 'note': {'state': 'manual'}}}
            files.update({f'data/records/{d}.json': r for d, r in remote.items()})
            seen_auth = []

            def fake_github(route):
                req = route.request
                gh_calls.append(req.url)
                seen_auth.append(req.headers.get('authorization'))
                m2 = re.match(r'https://api\.github\.com/repos/([^/]+/[^/]+)/contents/(.+)$', req.url)
                if req.method == 'OPTIONS':
                    route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept'}); return
                if req.headers.get('authorization') != f'Bearer {TOKEN}':
                    route.fulfill(status=401, body='{}', headers={'access-control-allow-origin': '*'}); return
                if not m2 or m2.group(1) != REPO or m2.group(2) not in files:
                    route.fulfill(status=404, body='{}', headers={'access-control-allow-origin': '*'}); return
                route.fulfill(status=200, body=json.dumps(files[m2.group(2)]), headers={'access-control-allow-origin': '*', 'content-type': 'application/vnd.github.raw+json'})

            mine = {
                ds[0]: {'date': ds[0], 'x': {'followers': None, 'impressions': None, 'posts': None, 'engagement': None},
                        'threads': {'followers': None, 'impressions': None, 'posts': None, 'engagement': None},
                        'note': {'followers': 31, 'pv': 77, 'impressions': 900, 'likes': 4}, 'memo': '手で書いたメモ'},
                ds[1]: {'date': ds[1], 'x': {'followers': 101, 'impressions': 4321, 'posts': 3, 'engagement': 9},
                        'threads': {'followers': 51, 'impressions': 501, 'posts': 2, 'engagement': 4},
                        'note': {'followers': None, 'pv': None, 'impressions': None, 'likes': None}, 'memo': '',
                        'auto': {'from': 'github', 'fetchedAt': remote[ds[1]]['fetchedAt'], 'got': {'x': {'impressions': 1001}, 'threads': {}, 'note': {}}}},
                late: {'date': late, 'x': {'followers': 88, 'impressions': None, 'posts': None, 'engagement': None},
                       'threads': {'followers': None, 'impressions': None, 'posts': None, 'engagement': None},
                       'note': {'followers': None, 'pv': None, 'impressions': None, 'likes': None}, 'memo': ''},
            }
            seed_data = json.dumps({'version': 1, 'records': mine, 'settings': {'platforms': {'x': True, 'threads': True, 'note': True}}, 'lastBackupAt': None})

            ctx, pg = page({DATA_KEY: seed_data}, fake_github)
            pg.click('#gh-tool summary')
            pg.fill('#gh-repo', 'test-user/stats-repo'); pg.fill('#gh-token', 'wrong-token'); pg.click('#gh-connect')
            pg.wait_for_function("document.querySelector('#gh-form-msg').textContent.includes('鍵が使えません')", timeout=8000)
            check('sns-kirokucho.github' not in storage(pg), '鍵がまちがっているときは、つながず保存もしない')
            pg.fill('#gh-repo', 'https://github.com/test-user/stats-repo'); pg.fill('#gh-token', TOKEN); pg.click('#gh-connect')
            pg.wait_for_function("!document.querySelector('#gh-on').hidden && document.querySelector('#gh-last').textContent.includes('確かめました')", timeout=10000)
            st = storage(pg)
            saved = json.loads(st[DATA_KEY])['records']
            check(sorted(saved) == ds, f'{len(ds)} 日分がそろう')
            check(saved[ds[5]]['x']['impressions'] == 1005 and saved[ds[5]]['threads']['followers'] == 55, '取れた数字が入る')
            check(saved[ds[0]]['note'] == mine[ds[0]]['note'] and saved[ds[0]]['memo'] == '手で書いたメモ', '手で入れた note の数字とメモは残る')
            check(saved[ds[1]]['x']['impressions'] == 4321, '取り込んだあとに手で直した数字は上書きしない')
            check(saved[late]['x']['followers'] == 88 and saved[late]['x']['impressions'] == 1002, '後から取り直した日のフォロワー数は使わない（ほかの数字は入る）')
            check(TOKEN not in st[DATA_KEY] and REPO not in st[DATA_KEY], '記録の中に鍵やリポジトリ名が入らない')
            check(pg.input_value('#gh-token') == '', 'つないだあと、鍵の入力欄は空になる')
            check(pg.is_visible('#sync-notice') and 'Threads のログインが切れています' in pg.text_content('#sync-notice-text'), '取得の不具合（ログイン切れ）を上に知らせる')
            check(pg.locator('#rec-body .auto').count() >= len(ds) - 1, '一覧に「自動」の印が付く')
            with pg.expect_download() as dl:
                pg.click('#exp-json')
            exported = pathlib.Path(dl.value.path()).read_text(encoding='utf-8')
            check(TOKEN not in exported and REPO not in exported, '書き出すファイルに鍵やリポジトリ名が入らない')
            elsewhere = [u for u, a in all_reqs if not u.startswith('https://api.github.com/') and (a or TOKEN in u)]
            check(not elsewhere and not any(TOKEN in u for u, _ in all_reqs), '鍵は GitHub への問い合わせにだけ使い、アドレスにも入れない')
            n_calls = len(gh_calls)
            pg.reload(); pg.wait_for_timeout(700)
            check(len(gh_calls) == n_calls, '開き直しても、20分以内は問い合わせない')
            pg.click('#gh-tool summary'); pg.click('#gh-off'); pg.wait_for_timeout(200)
            st = storage(pg)
            check('sns-kirokucho.github' not in st and len(json.loads(st[DATA_KEY])['records']) == len(ds), 'つなぐのをやめると鍵は消え、記録は残る')
            ctx.close()
            check(not errors, 'ページのエラーなし' + ('' if not errors else f': {errors[:3]}'))
            browser.close()
    finally:
        srv.terminate()

    print()
    if FAILS:
        print(f'NG: {len(FAILS)} 件。公開しないでください。')
        sys.exit(1)
    print('OK: 公開して大丈夫です。')


if __name__ == '__main__':
    main()
