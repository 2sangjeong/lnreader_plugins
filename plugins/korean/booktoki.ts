import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

class Booktoki implements Plugin.PluginBase {
  id = 'booktoki';
  name = '북토끼 (Booktoki)';
  icon = 'src/kr/booktoki/icon.png';
  site = 'https://booktoki469.com';
  version = '1.9.10';
  static url: string | undefined;

  filters = {
    flareSolverrUrl: {
      label: 'FlareSolverr URL (끝에 /v1 포함 필수)',
      value: storage.get('booktoki_fs_url') || 'http://localhost:8191/v1',
      type: FilterTypes.TextInput,
    },
    flareSolverrKey: {
      label: 'FlareSolverr API Key (X-API-Key 헤더)',
      value: storage.get('booktoki_fs_key') || '',
      type: FilterTypes.TextInput,
    },
    phpSessId: {
      label: 'Session Cookie (PHPSESSID)',
      value: storage.get('booktoki_phpsessid') || '',
      type: FilterTypes.TextInput,
    },
    bookmarklet: {
      label: '북마크 코드 (전체 복사하여 사용)',
      value:
        "javascript:(function(){const m=document.cookie.match(/PHPSESSID=([^;]+)/);if(m)prompt('PHPSESSID 복사',m[1]);else alert('PHPSESSID를 찾을 수 없습니다. 캡차를 먼저 풀어주세요.');})();",
      type: FilterTypes.TextInput,
    },
  } satisfies Filters;

  private getFlareSolverrSettings(filters?: any) {
    let url = filters?.flareSolverrUrl?.value || '';
    let key = filters?.flareSolverrKey?.value || '';
    let phpSessId = filters?.phpSessId?.value || '';

    if (!url) {
      url = storage.get('booktoki_fs_url') || 'http://localhost:8191/v1';
    } else {
      storage.set('booktoki_fs_url', url);
      this.filters.flareSolverrUrl.value = url;
    }

    if (!key) {
      key = storage.get('booktoki_fs_key') || '';
    } else {
      storage.set('booktoki_fs_key', key);
      this.filters.flareSolverrKey.value = key;
    }

    if (!phpSessId) {
      phpSessId = storage.get('booktoki_phpsessid') || '';
    } else {
      storage.set('booktoki_phpsessid', phpSessId);
      this.filters.phpSessId.value = phpSessId;
    }

    if (url && !url.endsWith('/v1') && !url.endsWith('/v1/')) {
      url = url.replace(/\/$/, '') + '/v1';
    }
    return { url, key, phpSessId };
  }

  private getUserAgent(): string {
    const defaultUA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    try {
      // @ts-ignore
      const ua =
        navigator?.userAgent ||
        global?.userAgent ||
        window?.lnreader?.userAgent;
      if (ua && !ua.includes('node-fetch') && !ua.includes('undefined'))
        return ua;
    } catch (e) {}
    return defaultUA;
  }

  async checkUrl() {
    if (!Booktoki.url) {
      try {
        const res = await fetchApi(this.site);
        if (res.ok && !res.url.includes('survey-smiles.com')) {
          Booktoki.url = res.url.replace(/\/$/, '');
        } else {
          Booktoki.url = this.site;
        }
      } catch (e) {
        Booktoki.url = this.site;
      }
    }
  }

  private async fetchViaFlareSolverr(
    url: string,
    filters?: any,
  ): Promise<string> {
    const {
      url: fsUrl,
      key,
      phpSessId,
    } = this.getFlareSolverrSettings(filters);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) headers['X-API-Key'] = key;

    const cookies = [];
    if (phpSessId) {
      cookies.push({
        name: 'PHPSESSID',
        value: phpSessId,
        domain: new URL(Booktoki.url || this.site).hostname,
      });
    }

    const payload = JSON.stringify({
      cmd: 'request.get',
      url,
      maxTimeout: 60000,
      session: 'booktoki_fixed_session', // 세션 고정으로 브라우저 재사용
      cookies: cookies.length > 0 ? cookies : undefined,
    });
    let lastError: any;

    try {
      const res = await fetchApi(fsUrl, {
        method: 'POST',
        headers,
        body: payload,
      });
      return this.parseFlareSolverrResponse(await res.text());
    } catch (e: any) {
      lastError = e;
    }

    try {
      const res = await fetch(fsUrl, {
        method: 'POST',
        headers,
        body: payload,
      });
      return this.parseFlareSolverrResponse(await res.text());
    } catch (e: any) {
      throw new Error(
        `FlareSolverr 연결 실패:\n1. fetchApi: ${lastError?.message || lastError}\n2. fetch: ${e?.message || e}\n주소: ${fsUrl}\n(모바일망 사용 시 집 PC와 IP가 달라 FlareSolverr를 반드시 거쳐야 합니다.)`,
      );
    }
  }

  private parseFlareSolverrResponse(body: string): string {
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      throw new Error(`FlareSolverr 응답 비정상: ${body.substring(0, 100)}`);
    }

    if (json.status === 'ok') {
      const cookies = json.solution?.cookies || [];
      const cookieStr = cookies
        .map((c: any) => `${c.name}=${c.value}`)
        .join('; ');

      if (cookieStr) storage.set('booktoki_full_cookies', cookieStr);
      if (json.solution?.userAgent)
        storage.set('booktoki_cached_ua', json.solution.userAgent);

      const response = json.solution?.response || '';
      if (this.isCaptcha(response)) {
        throw new Error(
          '숫자 캡차가 발생했습니다. [설정 -> Filter -> 북마크 코드]를 전체 복사하여 브라우저에서 실행한 후, PHPSESSID 값을 가져와 설정에 입력해 주세요.',
        );
      }

      return response;
    }
    throw new Error(json.message || `FlareSolverr 오류 (${json.status})`);
  }

  private getCachedHeaders() {
    const fullCookies = storage.get('booktoki_full_cookies');
    const phpSessId = storage.get('booktoki_phpsessid');
    const ua = storage.get('booktoki_cached_ua') || this.getUserAgent();
    const headers: Record<string, string> = {
      'Referer': `${Booktoki.url}/`,
      'User-Agent': ua,
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    };
    if (fullCookies) {
      headers['Cookie'] = fullCookies;
      if (phpSessId && !fullCookies.includes('PHPSESSID')) {
        headers['Cookie'] += `; PHPSESSID=${phpSessId}`;
      }
    } else if (phpSessId) {
      headers['Cookie'] = `PHPSESSID=${phpSessId}`;
    }
    return headers;
  }

  private async fetchPage(url: string, filters?: any) {
    const cachedHeaders = this.getCachedHeaders();
    let body = '';
    try {
      const res = await fetchApi(url, { headers: cachedHeaders });
      body = await res.text();
      if (res.ok && !this.isCaptcha(body)) {
        if (
          !body.includes('challenge-platform') &&
          !body.includes('Just a moment...')
        ) {
          return { body };
        }
      }
    } catch (e) {}

    if (body && this.isCaptcha(body)) {
      throw new Error(
        "숫자 캡차가 발생했습니다. 상단 'WebView' 아이콘을 눌러 숫자를 입력하고 돌아와 주세요.",
      );
    }

    return { body: await this.fetchViaFlareSolverr(url, filters) };
  }

  private isCaptcha(body: string): boolean {
    return (
      body.includes('captcha_key') ||
      body.includes('fcaptcha') ||
      body.includes('숫자 입력')
    );
  }

  private decodeHtmlData(encoded: string): string {
    let result = '';
    for (let i = 0; i < encoded.length; i += 3) {
      result += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16));
    }
    return result;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels, filters }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    await this.checkUrl();
    const url = showLatestNovels
      ? `${Booktoki.url}/novel/p${pageNo}`
      : `${Booktoki.url}/novel?sst=wr_hit&sod=desc&page=${pageNo}`;
    const { body } = await this.fetchPage(url, filters);
    const loadedCheerio = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];
    loadedCheerio('#webtoon-list li').each((i, el) => {
      const name = loadedCheerio(el).find('.title').text().trim();
      const cover = loadedCheerio(el).find('img').attr('src');
      const novelUrl = loadedCheerio(el).find('a').attr('href');
      if (name && novelUrl) {
        novels.push({
          name,
          cover,
          path: novelUrl.replace(`${Booktoki.url}/`, ''),
        });
      }
    });
    return novels;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    await this.checkUrl();
    const url = `${Booktoki.url}/novel/p${pageNo}?stx=${encodeURIComponent(searchTerm)}`;
    const { body } = await this.fetchPage(url);
    const loadedCheerio = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];
    loadedCheerio('#webtoon-list li').each((i, el) => {
      const name = loadedCheerio(el).find('.title').text().trim();
      const cover = loadedCheerio(el).find('img').attr('src');
      const novelUrl = loadedCheerio(el).find('a').attr('href');
      if (name && novelUrl) {
        novels.push({
          name,
          cover,
          path: novelUrl.replace(`${Booktoki.url}/`, ''),
        });
      }
    });
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    await this.checkUrl();
    const cleanPath = novelPath.split('?')[0];
    const url = `${Booktoki.url}/${cleanPath}?sst=wr_num&sod=asc`;
    const { body } = await this.fetchPage(url);
    const loadedCheerio = parseHTML(body);
    const novelName = loadedCheerio('.view-title > span > b').text().trim();
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName,
      cover: loadedCheerio('.view-img > img').attr('src'),
      summary: loadedCheerio('.view-content:not([style])').text().trim(),
      author: loadedCheerio('.view-content a').first().text().trim(),
      chapters: [],
    };

    const seenPaths = new Set<string>();
    loadedCheerio('ul.list-body > li.list-item').each((i, el) => {
      const nameEl = loadedCheerio(el).find('.wr-subject > a');
      const chapterUrl = nameEl.attr('href');
      if (chapterUrl && !seenPaths.has(chapterUrl)) {
        seenPaths.add(chapterUrl);
        const clone = nameEl.clone();
        clone.find('span, i, b, em, img, small, strong, font').remove();
        let rawName = '';
        clone.contents().each((_, node) => {
          if (node.type === 'text') rawName += node.data;
        });
        rawName = rawName.trim();

        let chapterNum = 0;
        let chapterName = rawName;
        if (novelName && chapterName.startsWith(novelName)) {
          chapterName = chapterName
            .substring(novelName.length)
            .replace(/^[-_.\s]+/, '')
            .trim();
        }

        const hwMatch = chapterName.match(/(\d+)\s*(?:화|회|회차|장|부|편|권)/);
        if (hwMatch) {
          chapterNum = parseInt(hwMatch[1]);
          const cutIdx = chapterName.indexOf(hwMatch[0]) + hwMatch[0].length;
          chapterName = chapterName.substring(0, cutIdx).trim();
        } else {
          const numMatch = chapterName.match(/(\d+)/);
          if (numMatch) chapterNum = parseInt(numMatch[1]);
          else
            chapterNum =
              parseInt(
                loadedCheerio(el)
                  .find('.wr-num')
                  .text()
                  .replace(/[^0-9]/g, ''),
              ) || 0;
          chapterName = chapterName.replace(/\s+\d+$/, '').trim();
        }

        if (
          chapterNum === 0 &&
          (nameEl.text().includes('공지') ||
            loadedCheerio(el).find('.wr-num').text().includes('공지'))
        )
          return;
        chapterName =
          chapterName.replace(/^[-_.\s]+/, '').trim() ||
          rawName ||
          nameEl.text().trim();

        novel.chapters?.push({
          name: chapterName,
          path: chapterUrl.replace(`${Booktoki.url}/`, ''),
          releaseTime: loadedCheerio(el)
            .find('.wr-date')
            .text()
            .trim()
            .replace(/\./g, '-'),
          chapterNumber: chapterNum,
        });
      }
    });

    novel.chapters?.sort(
      (a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0),
    );
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    await this.checkUrl();
    const { body } = await this.fetchPage(`${Booktoki.url}/${chapterPath}`);
    const loadedCheerio = parseHTML(body);
    let decoded = '';
    loadedCheerio('script').each((i, s) => {
      const sc = loadedCheerio(s).html() || '';
      if (sc.includes('var html_data')) {
        let combined = '';
        const regex = /html_data\+='(.*?)';/g;
        let match;
        while ((match = regex.exec(sc)) !== null) combined += match[1];
        if (combined) decoded = this.decodeHtmlData(combined);
      }
    });

    let content =
      decoded ||
      loadedCheerio('#novel_content').html() ||
      loadedCheerio('.view-content').html() ||
      '';
    if (content) {
      const $ = parseHTML(content);
      $(
        'script, style, iframe, ins, [style*="display:none"], [style*="font-size:0"]',
      ).remove();
      content = $.html();
    }
    return content || '본문을 불러올 수 없습니다.';
  }

  resolveUrl(path: string) {
    return (Booktoki.url || this.site) + '/' + path;
  }
}

export default new Booktoki();
