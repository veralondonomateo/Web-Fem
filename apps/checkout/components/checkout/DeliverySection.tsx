"use client";

import { UseFormRegister, UseFormRegisterReturn, FieldErrors, UseFormWatch, UseFormSetValue } from "react-hook-form";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckoutFormData } from "@/types/checkout";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { DEPARTMENTS, DEPARTMENT_SLUGS } from "@/data/departments";

interface DeliverySectionProps {
  register: UseFormRegister<CheckoutFormData>;
  errors: FieldErrors<CheckoutFormData>;
  watch: UseFormWatch<CheckoutFormData>;
  setValue: UseFormSetValue<CheckoutFormData>;
}

// Strip characters not allowed in each field type
const onlyDigits = (v: string) => v.replace(/\D/g, "");
const onlyLetters = (v: string) => v.replace(/[^a-zA-ZáéíóúüÁÉÍÓÚÜ\s\-']/g, "");
const onlyAddress = (v: string) => v.replace(/[^a-zA-ZáéíóúüÁÉÍÓÚÜ0-9\s#\-.,°]/g, "");

function sanitizedRegister(
  reg: UseFormRegisterReturn,
  sanitize: (v: string) => string
) {
  const { onChange, ...rest } = reg;
  return {
    ...rest,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      e.target.value = sanitize(e.target.value);
      return onChange(e);
    },
  };
}

// Cache de ciudades por departamento, compartido entre montajes del componente.
const cityCache = new Map<string, string[]>();

/**
 * Sin ciudades el cliente no puede completar el pedido, así que esta carga no
 * puede depender de una sola petición: reintenta y, si la red sigue fallando,
 * cae al listado completo empaquetado (import dinámico, no entra en el bundle
 * inicial y solo se descarga en ese caso excepcional).
 */
async function fetchCities(state: string): Promise<string[]> {
  const cached = cityCache.get(state);
  if (cached) return cached;

  const slug = DEPARTMENT_SLUGS[state];
  if (!slug) return [];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api/cities/${slug}`);
      if (res.ok) {
        const { cities } = (await res.json()) as { cities: string[] };
        if (cities.length > 0) {
          cityCache.set(state, cities);
          return cities;
        }
      }
    } catch {
      /* red intermitente — reintentamos */
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }

  try {
    const { default: statesData } = await import("@/data/states.json");
    const found = statesData.states.find((s) => s.name === state);
    const cities = (found?.cities ?? []).slice().sort((a, b) => a.localeCompare(b, "es"));
    if (cities.length > 0) cityCache.set(state, cities);
    return cities;
  } catch {
    return [];
  }
}

export default function DeliverySection({ register, errors, watch, setValue }: DeliverySectionProps) {
  const selectedState = watch("state");
  const [cities, setCities] = useState<string[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  // Las opciones de departamento son estáticas (~1 KB en el bundle).
  const stateOptions = useMemo(
    () => DEPARTMENTS.map((d) => ({ value: d.name, label: d.name })),
    []
  );

  // Las ciudades llegan bajo demanda: respuesta estática cacheada en el CDN.
  // requestId evita que una respuesta lenta pise a una selección más reciente.
  const requestId = useRef(0);

  useEffect(() => {
    if (!selectedState) {
      setCities([]);
      setLoadingCities(false);
      return;
    }

    const id = ++requestId.current;
    const cached = cityCache.get(selectedState);
    if (cached) {
      setCities(cached);
      setLoadingCities(false);
      return;
    }

    setLoadingCities(true);
    fetchCities(selectedState)
      .then((list) => {
        if (requestId.current !== id) return;
        setCities(list);
      })
      .finally(() => {
        if (requestId.current === id) setLoadingCities(false);
      });
  }, [selectedState]);

  const cityOptions = useMemo(
    () => cities.map((c) => ({ value: c, label: c })),
    [cities]
  );

  // Ciudad precargada (link de recuperación): cuando el valor llega antes que
  // las opciones, el <select> no tiene todavía ese <option> y se queda vacío
  // aunque el formulario sí lo tenga. Al llegar la lista, se reescribe en el
  // DOM. Si la ciudad no está en el departamento, se limpia en vez de dejar
  // un valor fantasma que el usuario no ve.
  const selectedCity = watch("city");
  useEffect(() => {
    if (!selectedCity || cities.length === 0) return;
    setValue("city", cities.includes(selectedCity) ? selectedCity : "", {
      shouldValidate: false,
    });
  }, [cities, selectedCity, setValue]);

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setValue("state", e.target.value, { shouldValidate: true });
    setValue("city", "", { shouldValidate: false });
  };

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-6 h-6 rounded-full bg-[#fc5245] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">2</span>
        </div>
        <h2 className="font-semibold text-gray-900">Dirección de entrega</h2>
      </div>

      <div className="space-y-4">
        {/* Name row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Nombre"
            type="text"
            placeholder="Ana"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...sanitizedRegister(register("firstName"), onlyLetters)}
          />
          <Input
            label="Apellido"
            type="text"
            placeholder="García"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...sanitizedRegister(register("lastName"), onlyLetters)}
          />
        </div>

        {/* Cedula + Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Cédula o NIT"
            type="text"
            placeholder="Para factura electrónica"
            optional
            inputMode="numeric"
            error={errors.cedula?.message}
            {...sanitizedRegister(register("cedula"), onlyDigits)}
          />
          <Input
            label="Número de WhatsApp"
            type="tel"
            placeholder="3001234567"
            autoComplete="tel-national"
            inputMode="numeric"
            icon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            }
            error={errors.phone?.message}
            {...sanitizedRegister(register("phone"), onlyDigits)}
          />
        </div>

        {/* Address */}
        <Input
          label="Dirección"
          type="text"
          placeholder="Calle 123 # 45-67"
          autoComplete="street-address"
          error={errors.address?.message}
          {...sanitizedRegister(register("address"), onlyAddress)}
        />

        {/* Complement */}
        <Input
          label="Complemento"
          type="text"
          placeholder="Apto 301, Casa, Torre..."
          optional
          error={errors.complement?.message}
          {...sanitizedRegister(register("complement"), onlyAddress)}
        />

        {/* State & City */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Departamento"
            placeholder="Selecciona un departamento"
            options={stateOptions}
            error={errors.state?.message}
            {...register("state", {
              onChange: handleStateChange,
            })}
          />
          <Select
            label="Ciudad"
            placeholder={
              !selectedState
                ? "Primero elige el departamento"
                : loadingCities
                  ? "Cargando ciudades…"
                  : "Selecciona una ciudad"
            }
            options={cityOptions}
            loading={loadingCities}
            disabled={!selectedState || loadingCities}
            error={errors.city?.message}
            {...register("city")}
          />
        </div>
      </div>
    </section>
  );
}
