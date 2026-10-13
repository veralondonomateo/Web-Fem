// Generado desde data/ecuador-ciudades.json — solo los nombres de provincia.
// Las 1.056 ciudades NO viajan aquí: se piden por provincia a /api/ec/cities/[slug],
// que se prerenderiza en build y se sirve desde el CDN. Mismo patrón que Colombia.

export interface Provincia {
  name: string;
  slug: string;
}

export const PROVINCIAS_EC: Provincia[] = [
  { "name": "Azuay", "slug": "azuay" },
  { "name": "Bolivar", "slug": "bolivar" },
  { "name": "Cañar", "slug": "canar" },
  { "name": "Carchi", "slug": "carchi" },
  { "name": "Chimborazo", "slug": "chimborazo" },
  { "name": "Cotopaxi", "slug": "cotopaxi" },
  { "name": "El Oro", "slug": "el-oro" },
  { "name": "Esmeraldas", "slug": "esmeraldas" },
  { "name": "Galapagos", "slug": "galapagos" },
  { "name": "Guayas", "slug": "guayas" },
  { "name": "Imbabura", "slug": "imbabura" },
  { "name": "Loja", "slug": "loja" },
  { "name": "Los Rios", "slug": "los-rios" },
  { "name": "Manabi", "slug": "manabi" },
  { "name": "Morona-Santiago", "slug": "morona-santiago" },
  { "name": "Napo", "slug": "napo" },
  { "name": "Orellana", "slug": "orellana" },
  { "name": "Pastaza", "slug": "pastaza" },
  { "name": "Pichincha", "slug": "pichincha" },
  { "name": "Santa Elena", "slug": "santa-elena" },
  { "name": "Santo Domingo de los Tsachilas", "slug": "santo-domingo-de-los-tsachilas" },
  { "name": "Sucumbios", "slug": "sucumbios" },
  { "name": "Tungurahua", "slug": "tungurahua" },
  { "name": "Zamora-Chinchipe", "slug": "zamora-chinchipe" },
];
