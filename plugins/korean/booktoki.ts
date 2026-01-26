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
  version = '1.5.0';
  static url: string | undefined;

  filters = {
    flareSolverrUrl: {
      label: 'FlareSolverr URL (Nginx/개인 도메인)',
      value: 'http://localhost:8191/v1',
      type: FilterTypes.TextInput,
    },
    flareSolverrKey: {
      label: 'FlareSolverr API Key (X-API-Key 헤더)',
      value: '',
      type: FilterTypes.TextInput,
    },
  } satisfies Filters;

  private getFlareSolverrSettings(filters?: any) {
    const url =
      filters?.flareSolverrUrl?.value ||
      storage.get('booktoki_fs_url') ||
      'http://localhost:8191/v1';
    const key =
      filters?.flareSolverrKey?.value || storage.get('booktoki_fs_key') || '';

    if (filters?.flareSolverrUrl?.value)
      storage.set('booktoki_fs_url', filters.flareSolverrUrl.value);
    if (filters?.flareSolverrKey?.value)
      storage.set('booktoki_fs_key', filters.flareSolverrKey.value);

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
    const ua = this.getUserAgent();
    const { url: fsUrl, key } = this.getFlareSolverrSettings(filters);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (key) headers['X-API-Key'] = key;

      const res = await fetchApi(fsUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cmd: 'request.get',
          url,
          maxTimeout: 60000,
          userAgent: ua,
        }),
      });
      const body = await res.text();
      let json;
      try {
        json = JSON.parse(body);
      } catch (e) {
        throw new Error(
          ` FlareSolverr 응답 파싱 실패 (JSON 아님): ${body.substring(0, 100)}`,
        );
      }

      if (json.status === 'ok') {
        return json.solution.response;
      }
      throw new Error(json.message || 'FlareSolverr failed');
    } catch (e: any) {
      throw new Error(
        `FlareSolverr 우회 실패: ${e.message}\n설정 확인: ${fsUrl}`,
      );
    }
  }

  private getHeaders() {
    return {
      'Referer': `${Booktoki.url}/`,
      // User-Agent를 삭제하여 App 설정을 따르게 함
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    };
  }

  private async fetchPage(url: string, filters?: any) {
    let res, body;
    try {
      res = await fetchApi(url, { headers: this.getHeaders() });
      body = await res.text();
    } catch (e) {
      // Fallback to FlareSolverr on network error
      return { body: await this.fetchViaFlareSolverr(url, filters) };
    }

    if (
      res.status === 403 ||
      res.status === 503 ||
      body.includes('challenge-platform') ||
      body.includes('Cloudflare') ||
      body.includes('Just a moment...')
    ) {
      try {
        const flaresolverrBody = await this.fetchViaFlareSolverr(url, filters);
        return { body: flaresolverrBody };
      } catch (e: any) {
        throw new Error(
          `Cloudflare 차단됨 (${res.status}):\n` +
            `재시도 실패: ${e.message}\n` +
            `웹뷰로 접속하여 '사람 확인'을 완료하거나 FlareSolverr 설정을 확인해주세요.`,
        );
      }
    }
    return { res, body };
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

    let data;
    try {
      data = await this.fetchPage(url, filters);
    } catch (e) {
      if (pageNo === 1) {
        data = await this.fetchPage(`${Booktoki.url}`, filters);
      } else {
        throw e;
      }
    }

    const loadedCheerio = parseHTML(data.body);
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
    const { body } = await this.fetchPage(`${Booktoki.url}/${novelPath}`);
    const loadedCheerio = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: loadedCheerio('.view-title > span > b').text().trim(),
      cover: loadedCheerio('.view-img > img').attr('src'),
      summary: loadedCheerio('.view-content:not([style])').text().trim(),
    };

    loadedCheerio('.view-content:not([style])').each((i, el) => {
      const text = loadedCheerio(el).text();
      if (text.includes('작가')) {
        novel.author = loadedCheerio(el).find('a').text().trim();
      }
      if (text.includes('분류')) {
        const genres: string[] = [];
        loadedCheerio(el)
          .find('a')
          .each((i, g) => {
            genres.push(loadedCheerio(g).text().trim());
          });
        novel.genres = genres.join(', ');
      }
    });

    const chapters: Plugin.ChapterItem[] = [];
    loadedCheerio('ul.list-body > li.list-item').each((i, el) => {
      const name = loadedCheerio(el).find('.wr-subject > a').text().trim();
      const chapterUrl = loadedCheerio(el).find('.wr-subject > a').attr('href');
      const releaseTime = loadedCheerio(el).find('.wr-date').text().trim();

      if (name && chapterUrl) {
        chapters.push({
          name: name.replace(novel.name || '', '').trim(),
          path: chapterUrl.replace(`${Booktoki.url}/`, ''),
          releaseTime,
        });
      }
    });

    novel.chapters = chapters.reverse();
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    await this.checkUrl();
    const { body } = await this.fetchPage(`${Booktoki.url}/${chapterPath}`);
    const loadedCheerio = parseHTML(body);

    const scripts = loadedCheerio('script').toArray();
    let decodedContent = '';
    for (const script of scripts) {
      const scriptContent = loadedCheerio(script).html() || '';
      if (scriptContent.includes('var html_data')) {
        const regex = /html_data\+='(.*?)';/g;
        let match;
        let combined = '';
        while ((match = regex.exec(scriptContent)) !== null) {
          combined += match[1];
        }
        if (combined) {
          decodedContent = this.decodeHtmlData(combined);
          break;
        }
      }
    }

    let content = decodedContent;
    if (!content) {
      content = loadedCheerio('#novel_content').html() || '';
      if (!content) {
        content = loadedCheerio('.view-content').html() || '';
      }
    }

    if (content) {
      const $ = parseHTML(content);
      $('script, style, iframe, ins').remove();
      $('[style*="display:none"], [style*="display: none"]').remove();
      $('[style*="font-size:0"], [style*="font-size: 0"]').remove();
      $('[style*="visibility:hidden"], [style*="visibility: hidden"]').remove();
      $('[style*="opacity:0"], [style*="opacity: 0"]').remove();
      $('[style*="height:0"], [style*="height:0px"]').remove();
      $('[style*="width:0"], [style*="width:0px"]').remove();
      $('div, span').each((i, el) => {
        const style = $(el).attr('style');
        if (
          style &&
          (style.includes('font-size:0') || style.includes('display:none'))
        ) {
          $(el).remove();
        }
      });
      content = $.html() || '';
    }
    return content || '본문을 불러올 수 없습니다.';
  }

  resolveUrl(path: string, isNovel?: boolean) {
    return (Booktoki.url ? Booktoki.url : this.site) + '/' + path;
  }
}

export default new Booktoki();
