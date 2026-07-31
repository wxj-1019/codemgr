import { Folder, Package } from 'lucide-react';

export {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleX,
  Download,
  Ellipsis,
  Folder,
  Inbox,
  Info,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Moon,
  Package,
  PanelTopClose,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Square,
  Sun,
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
