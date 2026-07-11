import sampleCompanyConfig from "../rules/sample-company/config.json";

export const isPublicDemo = true;

export const availableCompanies = [
  {
    id: "sample-company",
    label: sampleCompanyConfig.company?.company_name || "sample-company",
  },
];

export function getConfig(companyId) {
  if (companyId !== "sample-company") {
    return undefined;
  }

  return sampleCompanyConfig;
}
