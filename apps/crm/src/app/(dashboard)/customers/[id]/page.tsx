'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, ShoppingBag, Phone, Mail, MapPin, Calendar, TrendingUp } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCOP, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, CUSTOMER_STATUS_LABELS, CUSTOMER_STATUS_COLORS, CHANNEL_LABELS, mostrarTelefono } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function CustomerProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/customers/${id}`)
      .then(data => {
        if (data?.id) setCustomer(data);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const daysSince = (date?: string) => date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null;
  const initials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-pepper-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-ink-muted">Cargando cliente…</p>
        </div>
      </div>
    );
  }

  if (notFound || !customer) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-ink-muted font-medium">Cliente no encontrado</p>
          <button onClick={() => router.back()} className="text-sm text-pepper-600 hover:underline">← Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 bg-white border-b border-brand-100 px-8 py-4 z-10 flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-brand-50 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-ink-soft" />
        </button>
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9">
            <AvatarFallback>{initials(customer.name)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-bold text-ink">{customer.name}</h1>
            {/* Teléfono y correo van aquí arriba, no solo en la tarjeta de
                contacto de más abajo: son los dos datos con los que se busca a
                una clienta, y tenerlos a la vista ahorra bajar a buscarlos. El
                correo se copia de un clic. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-ink-muted">{mostrarTelefono(customer.phone)}</span>
              {customer.email && (
                <button
                  onClick={() => navigator.clipboard?.writeText(customer.email)}
                  title="Copiar el correo"
                  className="text-xs text-ink-muted hover:text-pepper-600 transition-colors truncate max-w-[280px]"
                >· {customer.email}</button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', CUSTOMER_STATUS_COLORS[customer.status])}>
                {CUSTOMER_STATUS_LABELS[customer.status]}
              </span>
              {customer.originChannel && (
                <span className="text-xs text-muted-foreground">{CHANNEL_LABELS[customer.originChannel]}</span>
              )}
            </div>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <MessageSquare className="w-3.5 h-3.5" /> Enviar mensaje
          </Button>
        </div>
      </div>

      <div className="p-8 grid grid-cols-3 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Contact info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Información de contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-3.5 h-3.5 text-ink-muted" />
                <span className="text-ink-soft">{mostrarTelefono(customer.phone)}</span>
              </div>
              {customer.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5 text-ink-muted" />
                  <span className="text-ink-soft">{customer.email}</span>
                </div>
              )}
              {customer.city && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-3.5 h-3.5 text-ink-muted" />
                  <span className="text-ink-soft">{customer.city}, {customer.department}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-3.5 h-3.5 text-ink-muted" />
                <span className="text-ink-soft">Primer contacto: {customer.firstContactAt ? formatDate(customer.firstContactAt) : '—'}</span>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Métricas del cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">LTV total</span>
                <span className="font-bold text-pepper-600 text-lg">{formatCOP(customer.ltv)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total pedidos</span>
                <span className="font-semibold text-ink">{customer.totalOrders}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Última compra</span>
                <span className="text-sm text-ink-soft">{customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Días desde última compra</span>
                <span className={cn('font-medium text-sm', (daysSince(customer.lastPurchaseAt) || 0) > 30 ? 'text-orange-500' : 'text-ink-soft')}>
                  {daysSince(customer.lastPurchaseAt)}d
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Etiquetas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {(customer.tags ?? []).map((tag: string) => (
                  <span key={tag} className="px-3 py-1 bg-brand-50 text-brand-700 text-xs rounded-full font-medium border border-brand-100">
                    {tag}
                  </span>
                ))}
                {(customer.tags ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin etiquetas</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Notas del equipo</CardTitle>
            </CardHeader>
            <CardContent>
              {customer.notes ? (
                <p className="text-sm text-ink-soft leading-relaxed">{customer.notes}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Sin notas</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right columns (2 cols) */}
        <div className="col-span-2 space-y-6">
          {/* Order history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-pepper-600" />
                Historial de pedidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {customer.orders?.length > 0 ? (
                <div className="space-y-3">
                  {customer.orders.map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-4 bg-brand-50 rounded-xl border border-brand-100">
                      <div>
                        <p className="font-semibold text-sm text-ink">{order.shopifyOrderNumber || order.id.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(order.createdAt)}</p>
                      </div>
                      <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', ORDER_STATUS_COLORS[order.status])}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                      <p className="font-bold text-pepper-600">{formatCOP(order.totalAmount)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Sin pedidos registrados</p>
              )}
            </CardContent>
          </Card>

          {/* Journey timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Journey del cliente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative pl-6">
                <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-brand-50" />
                {[
                  { label: 'Primer contacto', date: customer.firstContactAt, color: 'bg-blue-400' },
                  { label: 'Primera compra', date: customer.firstPurchaseAt, color: 'bg-pepper-600' },
                  ...(customer.orders || []).slice(1).map((o: any, i: number) => ({
                    label: `Compra #${i + 2}`,
                    date: o.createdAt,
                    color: 'bg-pepper-600',
                  })),
                  customer.lastPurchaseAt && customer.orders?.length > 1 ? null : null,
                ].filter(Boolean).map((event: any, i) => (
                  <div key={i} className="relative flex items-start gap-3 mb-4 last:mb-0">
                    <div className={`absolute -left-4 w-2.5 h-2.5 rounded-full border-2 border-white ${event.color} shadow-sm`} />
                    <div>
                      <p className="text-sm font-medium text-ink">{event.label}</p>
                      <p className="text-xs text-muted-foreground">{event.date ? formatDate(event.date) : '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
