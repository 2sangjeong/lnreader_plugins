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
  version = '1.9.0';
  static url: string | undefined;

  filters = {
    flareSolverrUrl: {
      label: 'FlareSolverr URL (끝에 /v1 포함 필수)',
      value: '',
      type: FilterTypes.TextInput,
    },
    flareSolverrKey: {
      label: 'FlareSolverr API Key (X-API-Key 헤더)',
      value: '',
      type: FilterTypes.TextInput,
    },
  } satisfies Filters;

  private getFlareSolverrSettings(filters?: any) {
    let url = filters?.flareSolverrUrl?.value || '';
    let key = filters?.flareSolverrKey?.value || '';

    if (!url) {
      url = storage.get('booktoki_fs_url') || 'http://localhost:8191/v1';
    } else {
      storage.set('booktoki_fs_url', url);
    }

    if (!key) {
      key = storage.get('booktoki_fs_key') || '';
    } else {
      storage.set('booktoki_fs_key', key);
    }

    if (url && !url.endsWith('/v1') && !url.endsWith('/v1/')) {
      url = url.replace(/\/$/, '') + '/v1';
    }
    return { url, key };
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
    const { url: fsUrl, key } = this.getFlareSolverrSettings(filters);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) headers['X-API-Key'] = key;

    const payload = JSON.stringify({
      cmd: 'request.get',
      url,
      maxTimeout: 60000,
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
        `FlareSolverr 연결 실패:\n1. fetchApi: ${lastError?.message || lastError}\n2. fetch: ${e?.message || e}\n주소: ${fsUrl}`,
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
      const cfClearance = cookies.find(
        (c: any) => c.name === 'cf_clearance',
      )?.value;
      if (cfClearance) storage.set('booktoki_cf_clearance', cfClearance);
      if (json.solution?.userAgent)
        storage.set('booktoki_cached_ua', json.solution.userAgent);

      return json.solution?.response || '';
    }
    throw new Error(json.message || `FlareSolverr 오류 (${json.status})`);
  }

  private getCachedHeaders() {
    const cfClearance = storage.get('booktoki_cf_clearance');
    const ua = storage.get('booktoki_cached_ua') || this.getUserAgent();
    const headers: Record<string, string> = {
      'Referer': `${Booktoki.url}/`,
      'User-Agent': ua,
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    };
    if (cfClearance) headers['Cookie'] = `cf_clearance=${cfClearance}`;
    return headers;
  }

  private async fetchPage(url: string, filters?: any) {
    try {
      const res = await fetchApi(url, { headers: this.getCachedHeaders() });
      const body = await res.text();
      if (
        res.ok &&
        !body.includes('challenge-platform') &&
        !body.includes('Just a moment...')
      ) {
        return { body };
      }
    } catch (e) {}

    return { body: await this.fetchViaFlareSolverr(url, filters) };
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
    const body = await this.fetchViaFlareSolverr(url);
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
        let fullTitle = nameEl.text().trim();
        nameEl.find('span, img, i').remove();
        let rawName = nameEl.text().trim();
        let chapterNum =
          parseInt(rawName.match(/(\d+)/)?.[1] || '0') ||
          parseInt(
            loadedCheerio(el)
              .find('.wr-num')
              .text()
              .replace(/[^0-9]/g, ''),
          ) ||
          0;
        if (
          chapterNum === 0 &&
          (fullTitle.includes('공지') ||
            loadedCheerio(el).find('.wr-num').text().includes('공지'))
        )
          return;
        let chapterName =
          novelName && rawName.includes(novelName)
            ? rawName.replace(novelName, '').trim()
            : rawName;
        chapterName = chapterName.replace(/^[-_.\s]+/, '').trim() || fullTitle;
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
