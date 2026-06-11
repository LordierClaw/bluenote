const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>

export async function importPublicPackage(specifier: string, loader?: (specifier: string) => Promise<unknown>): Promise<unknown> {
  if (loader) return loader(specifier)
  return dynamicImport(specifier)
}
