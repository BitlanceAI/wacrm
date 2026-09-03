"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Loader2 } from "lucide-react";
import { savePlan, setPlanActive, type PlanInput } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_monthly_minor: number;
  price_yearly_minor: number | null;
  currency: string;
  features: string[];
  highlight: boolean;
  active: boolean;
  sort_order: number;
}

const rupees = (minor: number) =>
  `₹${new Intl.NumberFormat("en-IN").format(minor / 100)}`;

function emptyForm(): PlanInput {
  return {
    slug: "",
    name: "",
    description: "",
    price_monthly: "",
    price_yearly: "",
    features_text: "",
    highlight: false,
    active: true,
    sort_order: 99,
  };
}

function formFromRow(row: PlanRow): PlanInput {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    price_monthly: String(row.price_monthly_minor / 100),
    price_yearly:
      row.price_yearly_minor != null ? String(row.price_yearly_minor / 100) : "",
    features_text: (row.features ?? []).join("\n"),
    highlight: row.highlight,
    active: row.active,
    sort_order: row.sort_order,
  };
}

export function PlanManager({ initialPlans }: { initialPlans: PlanRow[] }) {
  const [plans] = useState(initialPlans);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<PlanInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  function openNew() {
    setForm(emptyForm());
    setEditing({ id: null });
  }
  function openEdit(row: PlanRow) {
    setForm(formFromRow(row));
    setEditing({ id: row.id });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await savePlan(editing?.id ?? null, form);
      toast.success(editing?.id ? "Plan updated" : "Plan created");
      setEditing(null);
      // Server action revalidates the route; a reload picks up fresh rows.
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save plan");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row: PlanRow) {
    setToggling(row.id);
    try {
      await setPlanActive(row.id, !row.active);
      toast.success(row.active ? "Plan hidden from pricing page" : "Plan live");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update plan");
      setToggling(null);
    }
  }

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-sm font-medium text-foreground">
          Plans <span className="text-muted-foreground">({plans.length})</span>
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-3.5" /> New plan
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Monthly</TableHead>
            <TableHead className="text-right">Yearly</TableHead>
            <TableHead>Features</TableHead>
            <TableHead>Highlight</TableHead>
            <TableHead>Live</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((row) => (
            <TableRow key={row.id} className={row.active ? "" : "opacity-50"}>
              <TableCell>
                <p className="font-medium text-foreground">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.slug}</p>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {rupees(row.price_monthly_minor)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.price_yearly_minor != null
                  ? rupees(row.price_yearly_minor)
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {(row.features ?? []).length} bullet
                {(row.features ?? []).length === 1 ? "" : "s"}
              </TableCell>
              <TableCell>{row.highlight ? "★" : "—"}</TableCell>
              <TableCell>
                <Switch
                  checked={row.active}
                  disabled={toggling === row.id}
                  onCheckedChange={() => handleToggleActive(row)}
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => openEdit(row)}
                >
                  <Pencil className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="border-border bg-background sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editing?.id ? "Edit plan" : "New plan"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Prices are in rupees; features are one bullet per line.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Growth"
                  className="border-border bg-accent text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground">Slug</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="growth"
                  disabled={!!editing?.id}
                  className="border-border bg-accent font-mono text-foreground"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground">Description</Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="For growing teams…"
                className="border-border bg-accent text-foreground"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-foreground">Monthly (₹)</Label>
                <Input
                  value={form.price_monthly}
                  onChange={(e) =>
                    setForm({ ...form, price_monthly: e.target.value })
                  }
                  placeholder="2499"
                  className="border-border bg-accent text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground">Yearly (₹)</Label>
                <Input
                  value={form.price_yearly}
                  onChange={(e) =>
                    setForm({ ...form, price_yearly: e.target.value })
                  }
                  placeholder="24990"
                  className="border-border bg-accent text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground">Sort</Label>
                <Input
                  value={String(form.sort_order)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sort_order: Number(e.target.value) || 0,
                    })
                  }
                  className="border-border bg-accent text-foreground"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground">Features (one per line)</Label>
              <Textarea
                value={form.features_text}
                onChange={(e) =>
                  setForm({ ...form, features_text: e.target.value })
                }
                rows={6}
                className="border-border bg-accent text-foreground"
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch
                  checked={form.highlight}
                  onCheckedChange={(v) => setForm({ ...form, highlight: v })}
                />
                Most popular badge
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
                Live
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              className="border-border text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
