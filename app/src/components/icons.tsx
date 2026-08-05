import { Folder, Package } from 'lucide-react';

export {
  Activity,
  AlertCircle,
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleX,
  Code,
  Copy,
  Download,
  Ellipsis,
  Focus,
  Folder,
  FolderOpen,
  Globe,
  House,
  Inbox,
  Info,
  Layers,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Moon,
  Package,
  PanelTopClose,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';

/** Compatibility wrappers retained for existing call sites. */
export function FolderIcon() {
  return <Folder size={12} strokeWidth={2} aria-hidden="true" />;
}

export function PackageIcon() {
  return <Package size={12} strokeWidth={2} aria-hidden="true" />;
}