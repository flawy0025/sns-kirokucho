#!/usr/bin/env python3
"""公開前のチェック（記録が消えないか）

今の形の記録が、新しい版のアプリでもそのまま読めて、保存しても壊れないことを確かめます。
公開（git push）の前に、毎回これを通してください。

  python3 dev/check.py

必要なもの: Python の playwright と Chromium（`pip install playwright` → `playwright install chromium`）
"""
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

    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/'
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            errors = []

            def page(seed):
                ctx = browser.new_context(viewport={'width': 400, 'height': 860}, accept_downloads=True, service_workers='block')
                ctx.route(re.compile(r'https://(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)/.*'), lambda r: r.abort())
                pg = ctx.new_page()
                pg.on('pageerror', lambda e: errors.append(str(e)))
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
