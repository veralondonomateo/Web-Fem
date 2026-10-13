// Generado desde data/states.json — solo los nombres de departamento (~1 KB).
// Las ciudades NO se incluyen aquí: se cargan bajo demanda desde /api/cities/[slug],
// que se prerenderiza en build y se sirve desde el CDN.

export interface Department {
  name: string;
  slug: string;
}

export const DEPARTMENTS: Department[] = [
  {
    "name": "Amazonas",
    "slug": "amazonas"
  },
  {
    "name": "Antioquia",
    "slug": "antioquia"
  },
  {
    "name": "Arauca",
    "slug": "arauca"
  },
  {
    "name": "Archipiélago de San Andrés, Providencia y Santa Catalina",
    "slug": "archipielago-de-san-andres-providencia-y-santa-catalina"
  },
  {
    "name": "Atlántico",
    "slug": "atlantico"
  },
  {
    "name": "Bolívar",
    "slug": "bolivar"
  },
  {
    "name": "Boyacá",
    "slug": "boyaca"
  },
  {
    "name": "Caldas",
    "slug": "caldas"
  },
  {
    "name": "Caquetá",
    "slug": "caqueta"
  },
  {
    "name": "Casanare",
    "slug": "casanare"
  },
  {
    "name": "Cauca",
    "slug": "cauca"
  },
  {
    "name": "Cesar",
    "slug": "cesar"
  },
  {
    "name": "Chocó",
    "slug": "choco"
  },
  {
    "name": "Córdoba",
    "slug": "cordoba"
  },
  {
    "name": "Cundinamarca",
    "slug": "cundinamarca"
  },
  {
    "name": "Guainía",
    "slug": "guainia"
  },
  {
    "name": "Guaviare",
    "slug": "guaviare"
  },
  {
    "name": "Huila",
    "slug": "huila"
  },
  {
    "name": "La Guajira",
    "slug": "la-guajira"
  },
  {
    "name": "Magdalena",
    "slug": "magdalena"
  },
  {
    "name": "Meta",
    "slug": "meta"
  },
  {
    "name": "Nariño",
    "slug": "narino"
  },
  {
    "name": "Norte de Santander",
    "slug": "norte-de-santander"
  },
  {
    "name": "Putumayo",
    "slug": "putumayo"
  },
  {
    "name": "Quindío",
    "slug": "quindio"
  },
  {
    "name": "Risaralda",
    "slug": "risaralda"
  },
  {
    "name": "Santander",
    "slug": "santander"
  },
  {
    "name": "Sucre",
    "slug": "sucre"
  },
  {
    "name": "Tolima",
    "slug": "tolima"
  },
  {
    "name": "Valle del Cauca",
    "slug": "valle-del-cauca"
  },
  {
    "name": "Vaupés",
    "slug": "vaupes"
  },
  {
    "name": "Vichada",
    "slug": "vichada"
  }
];

export const DEPARTMENT_SLUGS: Record<string, string> = Object.fromEntries(
  DEPARTMENTS.map((d) => [d.name, d.slug])
);
