import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

class Booktoki implements Plugin.PluginBase {
  id = 'booktoki';
  name = '북토끼 (Booktoki)';
  icon = 'src/kr/booktoki/icon.png';
  site = 'https://booktoki469.com';
  version = '1.1.2';
  static url: string | undefined;

  async checkUrl() {
    if (!Booktoki.url) {
      try {
        const domainRes = await fetchApi(
          'https://stevenyomi.github.io/source-domains/newtoki.txt',
        );
        const domainNumber = (await domainRes.text()).trim();
        if (domainNumber) {
          Booktoki.url = `https://booktoki${domainNumber}.com`;
        } else {
          Booktoki.url = this.site;
        }
      } catch (e) {
        Booktoki.url = this.site;
      }
    }
  }

  private getUserAgent(): string | undefined {
    try {
      // @ts-ignore
      const ua = navigator?.userAgent || global?.userAgent;
      if (ua && ua !== 'undefined' && ua !== 'null') {
        return ua;
      }
    } catch (e) {
      // ignore
    }
    return undefined;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Referer': `${Booktoki.url}/`,
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };
    const ua = this.getUserAgent();
    if (ua) {
      headers['User-Agent'] = ua;
    }
    return headers;
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    await this.checkUrl();
    const url = showLatestNovels
      ? `${Booktoki.url}/novel/p${pageNo}`
      : `${Booktoki.url}/novel?sst=wr_hit&sod=desc&page=${pageNo}`;

    const res = await fetchApi(url, {
      headers: this.getHeaders(),
    });
    const body = await res.text();
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

    if (novels.length === 0) {
      const title = loadedCheerio('title').text().trim();
      const ua = this.getUserAgent() || 'App Default';
      throw new Error(
        `NoNovelsFound: ${title} | ${url} | UA: ${ua} | ${body.trim().substring(0, 100)}`,
      );
    }

    return novels;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    await this.checkUrl();
    const url = `${Booktoki.url}/novel/p${pageNo}?stx=${encodeURIComponent(searchTerm)}`;

    const res = await fetchApi(url, {
      headers: this.getHeaders(),
    });
    const body = await res.text();
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

    if (novels.length === 0) {
      const title = loadedCheerio('title').text().trim();
      const ua = this.getUserAgent() || 'App Default';
      throw new Error(
        `NoNovelsFound: ${title} | ${url} | UA: ${ua} | ${body.trim().substring(0, 100)}`,
      );
    }

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    await this.checkUrl();
    const res = await fetchApi(`${Booktoki.url}/${novelPath}`, {
      headers: this.getHeaders(),
    });
    const body = await res.text();
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
    const res = await fetchApi(`${Booktoki.url}/${chapterPath}`, {
      headers: this.getHeaders(),
    });
    const body = await res.text();
    const loadedCheerio = parseHTML(body);

    // Extracting novel content
    // Based on user request, it's usually .view-content or #novel_content
    let content = loadedCheerio('#novel_content').html() || '';
    if (!content) {
      content = loadedCheerio('.view-content').html() || '';
    }

    if (content) {
      // Remove scripts and other unnecessary tags
      const contentCheerio = parseHTML(content);
      contentCheerio('script').remove();
      contentCheerio('div[style*="display:none"]').remove();
      contentCheerio('div[style*="font-size:0"]').remove();
      content = contentCheerio.html() || '';
    }

    return content || '본문을 불러올 수 없습니다. (웹뷰에서 확인해 주세요)';
  }

  resolveUrl(path: string, isNovel?: boolean) {
    return (Booktoki.url ? Booktoki.url : this.site) + '/' + path;
  }
}

export default new Booktoki();
