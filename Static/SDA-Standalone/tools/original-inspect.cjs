async function inspect(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const viewportWidth = document.documentElement.clientWidth;
    const selector = element => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const classes = [...element.classList].slice(0, 4).map(name => `.${CSS.escape(name)}`).join('');
      return `${element.tagName.toLowerCase()}${classes}`;
    };
    const measured = [...document.querySelectorAll('*')].map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector: selector(element), tag: element.tagName.toLowerCase(),
        left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10, scrollWidth: element.scrollWidth,
        position: style.position, display: style.display, boxSizing: style.boxSizing,
        cssWidth: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
        marginLeft: style.marginLeft, marginRight: style.marginRight,
        paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
        overflowX: style.overflowX
      };
    });
    const overflowContributors = measured
      .filter(item => item.right > viewportWidth + 0.5 || item.left < -0.5 || item.scrollWidth > Math.ceil(item.width) + 1)
      .sort((a, b) => Math.max(b.right - viewportWidth, -b.left, b.scrollWidth - b.width) - Math.max(a.right - viewportWidth, -a.left, a.scrollWidth - a.width))
      .slice(0, 30);
    const probe = query => [...document.querySelectorAll(query)].slice(0, 20).map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { selector: selector(element), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, cssWidth: style.width, minWidth: style.minWidth, marginLeft: style.marginLeft, marginRight: style.marginRight, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, overflowX: style.overflowX };
    });
    return {
      viewport: { width: viewportWidth, height: document.documentElement.clientHeight },
      document: { width: doc.scrollWidth, height: doc.scrollHeight, bodyWidth: body.scrollWidth, bodyHeight: body.scrollHeight },
      overflow: { horizontalPixels: Math.max(0, doc.scrollWidth - viewportWidth), contributors: overflowContributors },
      probes: {
        headerIframes: probe('header iframe, #header-content iframe'),
        bootstrapRows: probe('.row'),
        cmsColumns: probe('.ccm-layout-column-wrapper, .ccm-layout-column'),
        imagesAndSocial: probe('img, svg'),
        navigation: probe('header nav, .header-navi, .navbar, .animenu'),
        forms: probe('form, input, textarea, select'),
        tables: probe('table')
      }
    };
  });
}

module.exports=inspect;
