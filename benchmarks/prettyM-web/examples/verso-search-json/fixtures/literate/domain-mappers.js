

/**
 * @type {DomainMapper}
 */
const VersoHtml_DOT_constant = {
    dataToSearchables:
      (domainData) =>
        Object.entries(domainData.contents).map(([key, value]) => ({
          searchKey: `${value[0].data.userName}`,
          address: `${value[0].address}#${value[0].id}`,
          domainId: 'VersoHtml.constant',
          ref: value,
        })),
    className: "const",
    displayName: "Declaration",
    };

/**
 * @type {DomainMapper}
 */
const VersoHtml_DOT_module = {
    dataToSearchables:
      (domainData) =>
        Object.entries(domainData.contents).map(([key, value]) => ({
          searchKey: key,
          address: `${value[0].address}#${value[0].id}`,
          domainId: 'VersoHtml.module',
          ref: value,
        })),
    className: "module",
    displayName: "Module",
    };

export const domainMappers = {"VersoHtml.constant":
    VersoHtml_DOT_constant,
  "VersoHtml.module": VersoHtml_DOT_module
};

export const searchPriorities = {
  semantic: 50,
    fullText: 50,
    domains: { }
  };
