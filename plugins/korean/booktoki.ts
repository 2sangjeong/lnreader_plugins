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
  version = '1.8.0';
  static url: string | undefined;

  filters = {
    flareSolverrUrl: {
      label: 'FlareSolverr URL (끝에 /v1 포함 필수)',
      value: '', // 하드코딩 제거
      type: FilterTypes.TextInput,
    },
    flareSolverrKey: {
      label: 'FlareSolverr API Key (X-API-Key 헤더)',
      value: '',
      type: FilterTypes.TextInput,
    },
  } satisfies Filters;

  private getFlareSolverrSettings(filters?: any) {
    // 1. 전달받은 필터 값이 있으면 최우선 (공백이 아닐 때)
    // 2. 필터가 없거나 공백이면 storage에서 조회
    // 3. 둘 다 없으면 localhost(전통적 기본값)

    let url = filters?.flareSolverrUrl?.value || '';
    let key = filters?.flareSolverrKey?.value || '';

    if (!url) {
      url = storage.get('booktoki_fs_url') || 'http://localhost:8191/v1';
    } else {
      // 필터에서 새로운 값이 들어왔으므로 storage 업데이트
      storage.set('booktoki_fs_url', url);
    }

    if (!key) {
      key = storage.get('booktoki_fs_key') || '';
    } else {
      storage.set('booktoki_fs_key', key);
    }

    // 전처리: 주소 맨 뒤 /v1 보정
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

    // 시도 1: fetchApi (네이티브 네트워크, CORS 우회 가능)
    try {
      const res = await fetchApi(fsUrl, {
        method: 'POST',
        headers,
        body: payload,
      });
      const body = await res.text();
      return this.parseFlareSolverrResponse(body);
    } catch (e: any) {
      lastError = e;
    }

    // 시도 2: 전역 fetch (웹뷰 네트워크, 인증서 처리에 차이가 있을 수 있음)
    try {
      const res = await fetch(fsUrl, {
        method: 'POST',
        headers,
        body: payload,
      });
      const body = await res.text();
      return this.parseFlareSolverrResponse(body);
    } catch (e: any) {
      throw new Error(
        `FlareSolverr 연결 실패:\n1. fetchApi: ${lastError?.message || lastError}\n2. fetch: ${e?.message || e}\n주소: ${fsUrl}\n(https 인증서 또는 CORS 설정을 확인해주세요)`,
      );
    }
  }

  private parseFlareSolverrResponse(body: string): string {
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      throw new Error(
        `FlareSolverr 응답이 JSON 형식이 아님: ${body.substring(0, 100)}`,
      );
    }

    if (json.status === 'ok') {
      const solutionBody = json.solution?.response || '';
      if (
        solutionBody.includes('Just a moment...') &&
        !solutionBody.includes('webtoon-list') &&
        !solutionBody.includes('post-row') &&
        !solutionBody.includes('view-title')
      ) {
        throw new Error(
          'FlareSolverr가 성공을 보고했으나, 응답 본문에 여전히 챌린지 페이지가 포함되어 있습니다.',
        );
      }
      return solutionBody;
    }
    throw new Error(json.message || `FlareSolverr 오류 (상태: ${json.status})`);
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
    const cleanPath = novelPath.split('?')[0];
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '',
      chapters: [],
    };
    let page = 1;
    let hasNextPage = true;
    const seenPaths = new Set<string>();

    // 최대 40페이지(약 4,000화)까지 탐색
    while (hasNextPage && page <= 40) {
      // sst=wr_num&sod=asc: 회차 번호 기준 오름차순 정렬
      const url = `${Booktoki.url}/${cleanPath}?sst=wr_num&sod=asc&page=${page}`;
      const { body } = await this.fetchPage(url);
      const loadedCheerio = parseHTML(body);

      if (page === 1) {
        novel.name = loadedCheerio('.view-title > span > b').text().trim();
        novel.cover = loadedCheerio('.view-img > img').attr('src');
        novel.summary = loadedCheerio('.view-content:not([style])')
          .text()
          .trim();
        novel.author = loadedCheerio('.view-content a').first().text().trim();
      }

      const items = loadedCheerio('ul.list-body > li.list-item');
      if (items.length === 0) {
        hasNextPage = false;
        break;
      }

      let addedInThisPage = 0;
      items.each((i, el) => {
        const nameEl = loadedCheerio(el).find('.wr-subject > a');
        const chapterUrl = nameEl.attr('href');
        const releaseTimeStr = loadedCheerio(el).find('.wr-date').text().trim();
        const wrNumText = loadedCheerio(el).find('.wr-num').text().trim();

        if (chapterUrl && !seenPaths.has(chapterUrl)) {
          seenPaths.add(chapterUrl);

          let fullTitle = nameEl.text().trim();
          nameEl.find('span, img, i').remove();
          let rawChapterName = nameEl.text().trim();

          // 1. 번호 추출 로직 (제목 우선 -> wr-num 보조)
          let chapterNum = 0;
          const titleNumMatch = rawChapterName.match(/(\d+)/);
          if (titleNumMatch) {
            chapterNum = parseInt(titleNumMatch[1]);
          } else {
            chapterNum = parseInt(wrNumText.replace(/[^0-9]/g, '')) || 0;
          }

          // 공지사항 등 유효하지 않은 항목 필터링
          if (
            chapterNum === 0 &&
            (fullTitle.includes('공지') || wrNumText.includes('공지'))
          ) {
            return;
          }

          // 이름 정제
          let chapterName = rawChapterName;
          if (novel.name && rawChapterName.includes(novel.name)) {
            chapterName = rawChapterName.replace(novel.name, '').trim();
          }
          chapterName = chapterName.replace(/^[-_.\s]+/, '').trim();
          if (!chapterName) chapterName = fullTitle;

          novel.chapters?.push({
            name: chapterName,
            path: chapterUrl.replace(`${Booktoki.url}/`, ''),
            releaseTime: releaseTimeStr.replace(/\./g, '-'),
            chapterNumber: chapterNum,
          });
          addedInThisPage++;
        }
      });

      // 다음 페이지 여부 확인 (pagination active 다음 요소 존재 여부)
      const nextBtn = loadedCheerio('.pagination .active').next('li').find('a');
      if (addedInThisPage === 0 || nextBtn.length === 0) {
        hasNextPage = false;
      } else {
        page++;
      }
    }

    // 최종 정렬 (숫자 기준 오름차순: 1화, 2화...)
    novel.chapters?.sort(
      (a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0),
    );

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
