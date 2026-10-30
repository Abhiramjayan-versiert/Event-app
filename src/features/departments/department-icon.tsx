import {
  Bed, Bus, ClipboardList, Coffee, Cpu, Camera, FileText, Handshake, Heart, Layers, Megaphone, Music, Palette,
  Presentation, Radio, Shield, Trophy, Truck, UserCheck, Users, Utensils, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  layers: Layers, wallet: Wallet, camera: Camera, megaphone: Megaphone, handshake: Handshake, "clipboard-list": ClipboardList,
  cpu: Cpu, truck: Truck, presentation: Presentation, coffee: Coffee, bus: Bus, bed: Bed, utensils: Utensils, shield: Shield,
  palette: Palette, "file-text": FileText, users: Users, "user-check": UserCheck, radio: Radio, music: Music, trophy: Trophy, heart: Heart,
};

export function DepartmentIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? Layers;
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md bg-ink text-lime", className)}>
      <Icon className="size-4" />
    </span>
  );
}
