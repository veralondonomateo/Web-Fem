-- Additive setup for the existing checkout database. No historical order is rewritten.
alter table public.orders add column if not exists fem_order_id bigint;
alter table public.orders add column if not exists fulfillment_status text;
create table if not exists public.fem_catalog_variants (
 variant_id bigint primary key,
 price_cents bigint not null check(price_cents > 0),
 available boolean not null default true,
 stock integer check(stock >= 0)
);
create table if not exists public.fem_order_registry (
 id bigint generated always as identity primary key,
 order_id uuid not null unique references public.orders(id),
 created_at timestamptz not null default now(),
 fulfillment_status text not null default 'pending' check(fulfillment_status in ('pending','sent','cancelled'))
);
create table if not exists public.fem_contact_messages (
 id uuid primary key default gen_random_uuid(),
 email text not null,
 name text not null default '',
 message text not null default '',
 created_at timestamptz not null default now()
);
alter table public.fem_catalog_variants enable row level security;
alter table public.fem_order_registry enable row level security;
alter table public.fem_contact_messages enable row level security;
revoke all on public.fem_catalog_variants,public.fem_order_registry,public.fem_contact_messages from anon,authenticated;
grant select,insert,update on public.fem_catalog_variants,public.fem_order_registry,public.fem_contact_messages to service_role;
grant usage,select on sequence public.fem_order_registry_id_seq to service_role;

create or replace function public.fem_register_order(p_order_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare result bigint; line record; current_stock integer;
begin
 -- The order lock serializes finalize, payment notifications and retry workers.
 perform 1 from public.orders where id=p_order_id and payment_status='approved' for update;
 if not found then raise exception 'El pedido no existe o el pago no está aprobado'; end if;
 select id into result from public.fem_order_registry where order_id=p_order_id;
 if found then return result; end if;
 if not exists(select 1 from public.order_items where order_id=p_order_id) then raise exception 'Pedido sin productos'; end if;
 for line in select shopify_variant_id as variant_id,sum(quantity)::integer as quantity from public.order_items where order_id=p_order_id group by shopify_variant_id order by shopify_variant_id loop
  if line.variant_id is null or line.quantity is null or line.quantity<1 then raise exception 'Variante inválida'; end if;
  select stock into current_stock from public.fem_catalog_variants where variant_id=line.variant_id and available for update;
  if not found then raise exception 'Producto no disponible'; end if;
  if current_stock is not null then
   if current_stock<line.quantity then raise exception 'Inventario insuficiente'; end if;
   update public.fem_catalog_variants set stock=stock-line.quantity where variant_id=line.variant_id;
  end if;
 end loop;
 insert into public.fem_order_registry(order_id) values(p_order_id) returning id into result;
 return result;
end;
$$;
revoke all on function public.fem_register_order(uuid) from public,anon,authenticated;
grant execute on function public.fem_register_order(uuid) to service_role;

-- A cash-on-delivery upsell must update the line, total and stock atomically.
-- This uses the same order lock as registration, including late upsells.
create or replace function public.fem_add_cod_upsell(p_order_id uuid,p_variant_id bigint,p_image text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_order record; current_stock integer; registered boolean; needs_review boolean;
begin
 select * into current_order from public.orders where id=p_order_id for update;
 if not found or current_order.payment_status is distinct from 'approved' or current_order.payment_method is distinct from 'contraentrega' then
  raise exception 'La oferta requiere un pedido contraentrega aprobado';
 end if;
 if current_order.shopify_order_id is not null then raise exception 'El pedido histórico requiere revisión'; end if;
 if exists(select 1 from public.order_items where order_id=p_order_id and
  (product_id='jabon-intimo-prebioticos' or shopify_variant_id=p_variant_id or (name ~* 'jab[oó]n' and name !~* 'combo|\+'))) then
  return jsonb_build_object('ok',true,'already',true);
 end if;
 select stock into current_stock from public.fem_catalog_variants where variant_id=p_variant_id and available for update;
 if not found or (current_stock is not null and current_stock<1) then raise exception 'Jabón no disponible'; end if;
 select exists(select 1 from public.fem_order_registry where order_id=p_order_id) into registered;
 if registered and current_stock is not null then
  update public.fem_catalog_variants set stock=stock-1 where variant_id=p_variant_id;
 end if;
 insert into public.order_items(order_id,product_id,name,variant,price,quantity,image,shopify_variant_id)
 values(p_order_id,'jabon-intimo-prebioticos','Jabón íntimo pH neutro','200 ml',19900,1,p_image,p_variant_id);
 needs_review := current_order.sendura_order_id is not null;
 update public.orders set total=total+19900,
  sendura_error=case when needs_review then 'REVISAR: jabón añadido después de emitir la guía. Coordinar su inclusión antes de despachar.' else sendura_error end
 where id=p_order_id;
 return jsonb_build_object('ok',true,'en_revision',needs_review);
end;
$$;
revoke all on function public.fem_add_cod_upsell(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.fem_add_cod_upsell(uuid,bigint,text) to service_role;
