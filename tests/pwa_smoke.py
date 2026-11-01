"""Exercise the real PWA under a GitHub Pages-style /Music/ deployment.

Copies source outside the checkout and mutates only the copy to test updates.
Run with the managed environment's approved socket/browser execution capability.
"""
import functools
import json
import math
import os
import re
import shutil
import struct
import tempfile
import threading
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright, expect


SOURCE = Path(__file__).resolve().parents[1]
CHROMIUM_EXECUTABLE = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
REQUIRED = ['index.html', 'styles.css', 'app.js', 'storage.js', 'appearance.js',
            'manifest.webmanifest', 'pwa.js', 'sw.js']
missing = [name for name in REQUIRED if not (SOURCE / name).is_file()]
if missing:
    raise SystemExit('PWA implementation not yet present: ' + ', '.join(missing))


def create_wav(path):
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b''.join(struct.pack('<h', int(1500 * math.sin(2 * math.pi * 220 * i / 8000)))
                               for i in range(8000 * 40)))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json', '.js': 'text/javascript'}

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


checks = []


def passed(name):
    checks.append(name)
    print('PASS', name, flush=True)


def wait_worker(page):
    page.evaluate('async()=>{await navigator.serviceWorker.ready}')
    page.wait_for_function('navigator.serviceWorker.controller !== null')


with tempfile.TemporaryDirectory(prefix='onda-pwa-') as directory:
    root = Path(directory)
    project = root / 'Music'
    shutil.copytree(SOURCE, project, ignore=shutil.ignore_patterns('.git', '__pycache__', '.venv', 'node_modules'))
    fixture = root / 'Teste - Áudio offline.wav'
    create_wav(fixture)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    app_url = origin + '/Music/'
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=CHROMIUM_EXECUTABLE, headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1280, 'height': 900})
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            response = page.goto(app_url)
            assert response.status == 200
            wait_worker(page)
            manifest = page.evaluate('async()=>await (await fetch(document.querySelector("link[rel=manifest]").href)).json()')
            assert manifest['display'] in ['standalone', 'minimal-ui']
            for field in ['id', 'start_url', 'scope']:
                assert urljoin(app_url, manifest[field]) == app_url, (field, manifest[field])
            sizes = set()
            for icon in manifest['icons']:
                response = context.request.get(urljoin(app_url, icon['src']))
                assert response.ok, icon
                if icon.get('type') == 'image/png':
                    data = response.body()
                    assert data[:8] == b'\x89PNG\r\n\x1a\n', icon
                    width, height = struct.unpack('>II', data[16:24])
                    assert f'{width}x{height}' in icon['sizes'].split(), (icon, width, height)
                sizes.update(icon.get('sizes', '').split())
            assert {'192x192', '512x512'}.issubset(sizes), sizes
            registration_scope = page.evaluate('async()=> (await navigator.serviceWorker.getRegistration()).scope')
            assert registration_scope == app_url, registration_scope
            passed('Manifest, desktop display, icons and worker use the /Music/ subpath correctly')

            expect(page.locator('#offline-status')).to_be_attached()
            # Native installation prompting cannot be executed in headless mode.
            settings = page.locator('#settings-dialog')
            if not settings.is_visible():
                page.locator('#open-settings').click()
            expect(page.locator('#install-app')).to_be_attached()
            expect(page.locator('#install-status')).to_be_attached()
            expect(page.locator('#install-help')).to_be_attached()
            if not page.locator('#install-help').evaluate('(element)=>element.open'):
                page.locator('#install-help summary').click()
            assert page.locator('#install-help').inner_text().strip()
            page.keyboard.press('Escape')
            passed('Installation controls and browser-menu fallback instructions are present')

            page.locator('#file-input').set_input_files(str(fixture))
            expect(page.locator('.track-row')).to_have_count(1)
            page.locator('.track-details').click()
            page.wait_for_function('!document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>.2')
            page.locator('#play-pause').click()
            assert page.locator('#audio').evaluate('(a)=>a.duration>35')
            page.locator('#new-playlist').click()
            page.locator('#playlist-name').fill('Offline')
            page.locator('#save-playlist').click()
            expect(page.locator('#playlist-dialog')).to_be_hidden()
            page.locator('[data-view="library"]').click()
            page.locator('.track-row [data-action="favorite"]').click()
            page.locator('#open-settings').click()
            page.locator('input[name="theme"][value="dark"]').check()
            page.keyboard.press('Escape')
            page.close()
            context.set_offline(True)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            response = page.goto(app_url)
            assert response.status == 200
            expect(page.locator('.track-row')).to_have_count(1)
            expect(page.locator('[data-playlist-view]')).to_have_count(1)
            expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
            expect(page.locator('.favorite-button.is-favorite')).not_to_have_count(0)
            page.locator('.track-details').click()
            page.wait_for_function('!document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>.2')
            assert page.locator('#audio').evaluate('(a)=>a.duration>35')
            page.locator('#play-pause').click()
            passed('Closing and reopening offline restores the shell, song blob, playlist, favorite and theme; audio plays')

            page.goto(app_url + 'index.html')
            expect(page.locator('.track-row')).to_have_count(1)
            page.wait_for_function('document.querySelector("#audio").readyState>=1')
            assert page.locator('#audio').evaluate('(a)=>a.paused')
            context.set_offline(False)
            passed('Explicit /Music/index.html also opens offline without autoplay')

            outside = root / 'outside-data.txt'
            outside.write_text('first')
            assert page.evaluate('async()=>await(await fetch("/outside-data.txt")).text()') == 'first'
            outside.write_text('second')
            assert page.evaluate('async()=>await(await fetch("/outside-data.txt")).text()') == 'second'
            cache_urls = page.evaluate('async()=>{const result=[];for(const key of await caches.keys()){const cache=await caches.open(key);for(const request of await cache.keys())result.push(request.url)}return result}')
            assert not any('outside-data.txt' in url for url in cache_urls)
            not_found = context.request.get(app_url + 'missing-page.html')
            assert not_found.status == 404
            passed('Unrelated same-origin requests remain network requests and are not added to the app cache')

            # Add another application's cache to ensure activation cleans only this app.
            await_cache = '''async()=>{const other=await caches.open('unrelated-project-cache');await other.put('/elsewhere',new Response('preserve-me'));return await caches.keys()}'''
            old_caches = set(page.evaluate(await_cache)) - {'unrelated-project-cache'}
            assert old_caches
            sw = project / 'sw.js'
            content = sw.read_text()
            changed, number = re.subn(
                r'(const\s+CACHE_VERSION\s*=\s*)([\'"])([^\'"\r\n]*)\2',
                lambda match: f'{match[1]}{match[2]}{match[3]}-test-update{match[2]}',
                content,
                count=1,
            )
            assert number == 1, 'Expected a quoted CACHE_VERSION constant to exercise an update'
            sw.write_text(changed)
            page.locator('.track-details').click()
            page.wait_for_function('!document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>.2')
            time_before = page.locator('#audio').evaluate('(a)=>a.currentTime')
            page.evaluate('async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update()}')
            page.wait_for_function('async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)')
            assert page.locator('#audio').evaluate('(a)=>!a.paused')
            assert page.locator('#audio').evaluate('(a)=>a.currentTime') >= time_before
            assert old_caches.issubset(set(page.evaluate('async()=>await caches.keys()')))
            passed('A new worker installs and waits without interrupting active playback')

            page.locator('#open-settings').click()
            expect(page.locator('#update-app')).to_be_visible()
            with page.expect_navigation(wait_until='domcontentloaded'):
                page.locator('#update-app').click()
            expect(page.locator('.track-row')).to_have_count(1)
            expect(page.locator('[data-playlist-view]')).to_have_count(1)
            expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
            page.wait_for_function('document.querySelector("#audio").readyState>=1')
            assert page.locator('#audio').evaluate('(a)=>a.paused')
            new_caches = set(page.evaluate('async()=>await caches.keys()'))
            assert not old_caches.intersection(new_caches), (old_caches, new_caches)
            assert 'unrelated-project-cache' in new_caches
            assert page.evaluate('async()=>await(await (await caches.open("unrelated-project-cache")).match("/elsewhere")).text()') == 'preserve-me'
            passed('Explicit update reloads safely, preserves local data, and removes only this app’s previous cache')

            # New version must itself work offline after another full page close.
            page.close()
            context.set_offline(True)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(app_url)
            expect(page.locator('.track-row')).to_have_count(1)
            page.locator('.track-details').click()
            page.wait_for_function('!document.querySelector("#audio").paused && document.querySelector("#audio").currentTime>.2')
            passed('Updated app and stored music still open and play offline')
            assert not errors, errors
            passed('No JavaScript exceptions during installation, offline use or update')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False), flush=True)
