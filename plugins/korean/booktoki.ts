import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';

class Booktoki implements Plugin.PluginBase {
  id = 'booktoki';
  name = '북토끼 (Booktoki)';
  icon = 'src/kr/booktoki/icon.png';
  site = 'https://booktoki469.com';
  version = '1.2.0';
  static url: string | undefined;

  async checkUrl() {
    if (!Booktoki.url) {
      try {
        const res = await fetchApi(this.site);
        if (res.ok) {
          Booktoki.url = res.url.replace(/\/$/, '');
        } else {
          const domainRes = await fetchApi(
            'https://stevenyomi.github.io/source-domains/newtoki.txt',
          );
          const domainNumber = (await domainRes.text()).trim();
          if (domainNumber && !isNaN(Number(domainNumber))) {
            Booktoki.url = `https://booktoki${domainNumber}.com`;
          } else {
            Booktoki.url = this.site;
          }
        }
      } catch (e) {
        Booktoki.url = this.site;
      }
    }
  }

  private getUserAgent(): string {
    try {
      // @ts-ignore
      const ua = navigator?.userAgent || global?.userAgent;
      if (
        ua &&
        ua !== 'undefined' &&
        ua !== 'null' &&
        !ua.includes('undefined')
      ) {
        return ua;
      }
    } catch (e) {
      // ignore
    }
    return 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.103 Mobile Safari/537.36';
  }

  private decodeHtmlData(encoded: string): string {
    let result = '';
    for (let i = 0; i < encoded.length; i += 3) {
      result += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16));
    }
    return result;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Referer': `${Booktoki.url}/`,
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
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

    if (res.status === 403 || res.status === 503) {
      throw new Error(
        `접근 거부됨 (${res.status}): 웹뷰(WebView)에서 사이트를 열어 Cloudflare 확인을 완료해 주세요.`,
      );
    }

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
      if (body.includes('challenge-platform') || title.includes('Cloudflare')) {
        throw new Error(
          'Cloudflare 차단됨: 웹뷰(WebView)에서 사이트를 열어 사람임을 확인해 주세요.',
        );
      }
      throw new Error(
        `목록을 불러올 수 없습니다. (웹뷰 확인 필요) | Title: ${title}`,
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

    if (res.status === 403 || res.status === 503) {
      throw new Error(
        `접근 거부됨 (${res.status}): 웹뷰(WebView)에서 사이트를 열어 Cloudflare 확인을 완료해 주세요.`,
      );
    }

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
      if (body.includes('challenge-platform') || title.includes('Cloudflare')) {
        throw new Error(
          'Cloudflare 차단됨: 웹뷰(WebView)에서 사이트를 열어 사람임을 확인해 주세요.',
        );
      }
      throw new Error(
        `검색 결과를 불러올 수 없습니다. (웹뷰 확인 필요) | Title: ${title}`,
      );
    }
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    await this.checkUrl();
    const res = await fetchApi(`${Booktoki.url}/${novelPath}`, {
      headers: this.getHeaders(),
    });

    if (res.status === 403 || res.status === 503) {
      throw new Error(
        `접근 거부됨 (${res.status}): 웹뷰에서 Cloudflare를 확인해 주세요.`,
      );
    }

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

    if (res.status === 403 || res.status === 503) {
      throw new Error(
        `접근 거부됨 (${res.status}): 웹뷰에서 Cloudflare를 확인해 주세요.`,
      );
    }

    const body = await res.text();
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
      $('[style*="overflow:hidden"]').remove();

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
    return content || '본문을 불러올 수 없습니다. (웹뷰에서 확인해 주세요)';
  }

  resolveUrl(path: string, isNovel?: boolean) {
    return (Booktoki.url ? Booktoki.url : this.site) + '/' + path;
  }
}

export default new Booktoki();
