import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Sparkles,
  Users,
  MessageSquareText,
  UploadCloud,
  BarChart3,
  Palette,
  Plug,
  ScrollText,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Products", href: "/dashboard/products", icon: Package },
  { label: "Review Generator", href: "/dashboard/review-generator", icon: Sparkles },
  { label: "Reviewer Database", href: "/dashboard/reviewers", icon: Users },
  { label: "Generated Reviews", href: "/dashboard/reviews", icon: MessageSquareText },
  { label: "Upload Queue", href: "/dashboard/upload-queue", icon: UploadCloud },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Brand Settings", href: "/dashboard/brand-settings", icon: Palette },
  { label: "Review Provider", href: "/dashboard/review-provider", icon: Plug },
  { label: "Logs", href: "/dashboard/logs", icon: ScrollText },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];
