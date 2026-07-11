const configModules = import.meta.glob("../rules/*/config.json", {
  eager: true,
});

const companyLabels = {
  "sample-company": "サンプル会社",
  "company-a": "A株式会社",
};

export const isPublicDemo = false;

export const availableCompanies = Object.keys(configModules)
  .map((modulePath) => {
    const id = modulePath.match(/\.\.\/rules\/([^/]+)\/config\.json$/)?.[1];

    return {
      id,
      label:
        companyLabels[id] ||
        configModules[modulePath].default?.company?.company_name ||
        id,
    };
  })
  .filter((company) => company.id)
  .sort((left, right) => {
    if (left.id === "sample-company") {
      return -1;
    }

    if (right.id === "sample-company") {
      return 1;
    }

    return left.id.localeCompare(right.id);
  });

export function getConfig(companyId) {
  return configModules[`../rules/${companyId}/config.json`]?.default;
}
