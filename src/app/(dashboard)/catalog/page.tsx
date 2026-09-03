'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Package,
    ShoppingCart,
    Loader2,
    Plus,
    Trash2,
    FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/billing/money';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/commerce/order';
import { ConnectRequiredBanner } from '@/components/whatsapp/connect-required-banner';

interface Product {
    id: string;
    retailer_id: string;
    name: string;
    description?: string | null;
    price_minor: number;
    currency: string;
    in_stock: boolean;
}

interface OrderItem {
    id: string;
    retailer_id: string;
    name?: string | null;
    quantity: number;
    unit_price_minor: number;
    currency: string;
}

interface Order {
    id: string;
    status: OrderStatus;
    total_minor: number;
    currency: string;
    customer_note?: string | null;
    created_at: string;
    invoice_id?: string | null;
    contact?: { id: string; name?: string | null; phone?: string | null };
    items?: OrderItem[];
}

const ORDER_STATUS_STYLES: Record<string, string> = {
    received: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    confirmed: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    shipped: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    completed: 'bg-slate-500/10 text-muted-foreground border-border',
    cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function CatalogPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const [retailerId, setRetailerId] = useState('');
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');

    /**
     * Non-async on purpose, with the state updates inside .then():
     * React's cascading-render rule treats an awaited setState in a
     * function called straight from an effect as a synchronous one, and
     * this is the shape the dashboard loader already uses.
     */
    const load = useCallback(() => {
        return Promise.all([fetch('/api/products'), fetch('/api/orders')])
            .then(async ([productsRes, ordersRes]) => ({
                products: productsRes.ok
                    ? ((await productsRes.json()).products ?? [])
                    : null,
                orders: ordersRes.ok ? ((await ordersRes.json()).orders ?? []) : null,
            }))
            .then(({ products, orders }) => {
                if (products) setProducts(products);
                if (orders) setOrders(orders);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
                toast.error('Failed to load catalog');
            });
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function saveProduct() {
        if (!retailerId.trim() || !name.trim() || !price.trim()) {
            toast.error('SKU, name and price are required');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                retailer_id: retailerId.trim(),
                name: name.trim(),
                price: price.trim(),
                description: description.trim() || null,
            }),
        });
        setSaving(false);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to save product');
            return;
        }
        toast.success('Product saved');
        setDialogOpen(false);
        setRetailerId('');
        setName('');
        setPrice('');
        setDescription('');
        void load();
    }

    async function removeProduct(id: string) {
        const res = await fetch(`/api/products?id=${id}`, { method: 'DELETE' });
        if (!res.ok) {
            toast.error('Failed to delete product');
            return;
        }
        setProducts((prev) => prev.filter((p) => p.id !== id));
    }

    async function setOrderStatus(order: Order, status: OrderStatus) {
        const res = await fetch('/api/orders', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: order.id, status }),
        });
        if (!res.ok) {
            toast.error('Failed to update order');
            return;
        }
        void load();
    }

    async function raiseInvoice(order: Order) {
        const res = await fetch(`/api/orders/${order.id}/invoice`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to raise invoice');
            return;
        }
        toast.success(`Invoice ${data.invoice.number} created from this order`);
        void load();
    }

    return (
        <div className="space-y-5">
            <ConnectRequiredBanner />
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Catalog & Orders</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Products mirror your Meta Commerce Manager catalog — the SKU here must
                        match the catalog&apos;s content ID, because that&apos;s what an
                        incoming cart references.
                    </p>
                </div>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                    <Plus className="size-3.5" />
                    Add product
                </Button>
            </div>

            <Tabs defaultValue="orders">
                <TabsList className="border border-border bg-background">
                    <TabsTrigger
                        value="orders"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Orders
                    </TabsTrigger>
                    <TabsTrigger
                        value="products"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Products
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="space-y-2 pt-3">
                    {loading ? (
                        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading orders…
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="rounded-xl border border-border bg-background py-16 text-center">
                            <ShoppingCart className="mx-auto size-8 text-muted-foreground" />
                            <p className="mt-3 text-sm text-foreground">No orders yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Carts customers send from your catalog land here automatically.
                            </p>
                        </div>
                    ) : (
                        orders.map((order) => (
                            <div
                                key={order.id}
                                className="rounded-xl border border-border bg-background p-4"
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium text-foreground">
                                                {order.contact?.name || order.contact?.phone || 'Unknown'}
                                            </span>
                                            <span
                                                className={cn(
                                                    'rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                                                    ORDER_STATUS_STYLES[order.status],
                                                )}
                                            >
                                                {order.status}
                                            </span>
                                            <span className="text-sm font-semibold text-foreground">
                                                {formatMoney(order.total_minor, order.currency)}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {new Date(order.created_at).toLocaleString()}
                                        </p>
                                        {order.customer_note && (
                                            <p className="mt-1 text-xs italic text-muted-foreground">
                                                “{order.customer_note}”
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <select
                                            value={order.status}
                                            onChange={(e) =>
                                                setOrderStatus(order, e.target.value as OrderStatus)
                                            }
                                            className="h-7 rounded-md border border-border bg-accent px-2 text-xs capitalize text-foreground"
                                        >
                                            {ORDER_STATUSES.map((s) => (
                                                <option key={s} value={s}>
                                                    {s}
                                                </option>
                                            ))}
                                        </select>
                                        {!order.invoice_id && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => raiseInvoice(order)}
                                            >
                                                <FileText className="size-3.5" />
                                                Invoice
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {(order.items ?? []).length > 0 && (
                                    <div className="mt-3 space-y-1 border-t border-border pt-2">
                                        {order.items!.map((item) => (
                                            <div
                                                key={item.id}
                                                className="flex items-center justify-between text-xs"
                                            >
                                                <span className="text-muted-foreground">
                                                    {item.name || item.retailer_id} × {item.quantity}
                                                </span>
                                                <span className="text-foreground">
                                                    {formatMoney(
                                                        item.unit_price_minor * item.quantity,
                                                        item.currency,
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </TabsContent>

                <TabsContent value="products" className="space-y-2 pt-3">
                    {products.length === 0 ? (
                        <div className="rounded-xl border border-border bg-background py-16 text-center">
                            <Package className="mx-auto size-8 text-muted-foreground" />
                            <p className="mt-3 text-sm text-foreground">No products mirrored yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Adding them here doesn&apos;t create them in Meta — it lets the CRM
                                name the lines on incoming orders.
                            </p>
                        </div>
                    ) : (
                        products.map((product) => (
                            <div
                                key={product.id}
                                className="flex items-center gap-3 rounded-xl border border-border bg-background p-4"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-foreground">
                                            {product.name}
                                        </span>
                                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                            {product.retailer_id}
                                        </span>
                                        {!product.in_stock && (
                                            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                                                out of stock
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {formatMoney(product.price_minor, product.currency)}
                                        {product.description && ` · ${product.description}`}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0 text-muted-foreground hover:text-red-400"
                                    onClick={() => removeProduct(product.id)}
                                    aria-label={`Delete ${product.name}`}
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        ))
                    )}
                </TabsContent>
            </Tabs>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>Add product</DialogTitle>
                        <DialogDescription>
                            The SKU must match the content ID in Meta Commerce Manager — that
                            id is what an incoming cart refers to.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">SKU / content ID</Label>
                            <Input
                                value={retailerId}
                                onChange={(e) => setRetailerId(e.target.value)}
                                placeholder="SKU-1024"
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Name</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Price</Label>
                            <Input
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                inputMode="decimal"
                                placeholder="1499"
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Description</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                className="text-sm"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={saveProduct} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
