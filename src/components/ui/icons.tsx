import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import {
  HugeiconsIcon,
  type HugeiconsProps,
  type IconSvgElement,
} from "@hugeicons/react";
import {
  AccessibilityIcon,
  Activity01Icon,
  AiBrain01Icon,
  AiChipIcon,
  AiGenerativeIcon,
  AiMagicIcon,
  AiNetworkIcon,
  AiProgrammingIcon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  ArrowUpRight02Icon,
  BeakerIcon,
  BellIcon,
  BinaryIcon,
  BookOpen01Icon,
  BotIcon,
  BoxesIcon,
  Briefcase01Icon,
  Cancel01Icon,
  CancelSquareIcon,
  CaseSensitiveIcon,
  CheckIcon,
  CheckmarkCircle02Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  CodeIcon,
  Coffee02Icon,
  CompassIcon,
  ComputerIcon,
  ComputerTerminal01Icon,
  CopyIcon,
  CornerDownLeftIcon,
  CpuIcon,
  DatabaseIcon,
  Delete02Icon,
  Download01Icon,
  ExternalLinkIcon,
  EyeIcon,
  File02Icon,
  FileArchiveIcon,
  FileAudioIcon,
  FileBadgeIcon,
  FileBracesIcon,
  FileCodeIcon,
  FileCogIcon,
  FileDownIcon,
  FileEmpty02Icon,
  FileImageIcon,
  FileKeyIcon,
  FileLockedIcon,
  FilePlusIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileTypeIcon,
  FileVideoIcon,
  Folder01Icon,
  FolderAddIcon,
  FolderArchiveIcon,
  FolderCogIcon,
  FolderFileStorageIcon,
  FolderGitTwoIcon,
  FolderInputIcon,
  FolderLockedIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  GaugeIcon,
  GitBranchIcon,
  GitCompareIcon,
  GithubIcon,
  GlobeIcon,
  HashIcon,
  HeartIcon,
  Image02Icon,
  ImageAdd01Icon,
  ImageNotFound01Icon,
  InformationCircleIcon,
  KeyboardIcon,
  LaptopIcon,
  Layers01Icon,
  LayoutLeftIcon,
  Loading03Icon,
  MinusSignIcon,
  MoonIcon,
  MoreHorizontalIcon,
  MusicNote01Icon,
  PackageIcon,
  PaintBoardIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  Pdf02Icon,
  PencilIcon,
  PenTool01Icon,
  PlusSignIcon,
  Refresh01Icon,
  RegexIcon,
  Robot01Icon,
  RocketIcon,
  RotateLeft01Icon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  ShapesIcon,
  SlidersHorizontalIcon,
  SlidersVerticalIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  SparklesIcon,
  SquareIcon,
  StarIcon,
  Sun03Icon,
  Target01Icon,
  TerminalIcon,
  TextSquareIcon,
  Video01Icon,
  Wrench01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";

/**
 * Single icon registry for the whole app: Hugeicons stroke-rounded (free set)
 * wrapped as React components. Every icon the UI renders MUST come from here,
 * never from `@hugeicons/*` directly, so the icon set can be swapped or
 * extended in one file.
 *
 * Export names keep the semantic names call sites already used (they predate
 * the Hugeicons migration), mapped onto the closest stroke-rounded glyph. To
 * add an icon: import its data above, add one `iconOf(...)` export below.
 * Each export carries #__PURE__ so unused icons tree-shake out of the bundle.
 */
export type IconProps = Omit<HugeiconsProps, "icon" | "altIcon" | "ref">;
export type IconComponent = ForwardRefExoticComponent<
  IconProps & RefAttributes<SVGSVGElement>
>;

function iconOf(name: string, data: IconSvgElement): IconComponent {
  const C = forwardRef<SVGSVGElement, IconProps>(function IconGlyph(props, ref) {
    return <HugeiconsIcon ref={ref} icon={data} {...props} />;
  });
  C.displayName = name;
  return C;
}

// Status / feedback
export const AlertCircle = /*#__PURE__*/ iconOf("AlertCircle", AlertCircleIcon);
export const CircleAlert = AlertCircle;
export const AlertTriangle = /*#__PURE__*/ iconOf("AlertTriangle", Alert02Icon);
export const Check = /*#__PURE__*/ iconOf("Check", CheckIcon);
export const CheckCircle2 = /*#__PURE__*/ iconOf("CheckCircle2", CheckmarkCircle02Icon);
export const Info = /*#__PURE__*/ iconOf("Info", InformationCircleIcon);
export const Loader2 = /*#__PURE__*/ iconOf("Loader2", Loading03Icon);
export const Bell = /*#__PURE__*/ iconOf("Bell", BellIcon);

// Arrows / chevrons
export const ArrowDown = /*#__PURE__*/ iconOf("ArrowDown", ArrowDown02Icon);
export const ArrowUp = /*#__PURE__*/ iconOf("ArrowUp", ArrowUp02Icon);
export const ArrowUpRight = /*#__PURE__*/ iconOf("ArrowUpRight", ArrowUpRight02Icon);
export const ChevronDown = /*#__PURE__*/ iconOf("ChevronDown", ChevronDownIcon);
export const ChevronLeft = /*#__PURE__*/ iconOf("ChevronLeft", ChevronLeftIcon);
export const ChevronRight = /*#__PURE__*/ iconOf("ChevronRight", ChevronRightIcon);
export const CornerDownLeft = /*#__PURE__*/ iconOf("CornerDownLeft", CornerDownLeftIcon);

// Actions
export const Copy = /*#__PURE__*/ iconOf("Copy", CopyIcon);
export const Download = /*#__PURE__*/ iconOf("Download", Download01Icon);
export const ExternalLink = /*#__PURE__*/ iconOf("ExternalLink", ExternalLinkIcon);
export const Eye = /*#__PURE__*/ iconOf("Eye", EyeIcon);
export const Minus = /*#__PURE__*/ iconOf("Minus", MinusSignIcon);
export const MoreHorizontal = /*#__PURE__*/ iconOf("MoreHorizontal", MoreHorizontalIcon);
export const Pencil = /*#__PURE__*/ iconOf("Pencil", PencilIcon);
export const Plus = /*#__PURE__*/ iconOf("Plus", PlusSignIcon);
export const RefreshCw = /*#__PURE__*/ iconOf("RefreshCw", Refresh01Icon);
export const RotateCcw = /*#__PURE__*/ iconOf("RotateCcw", RotateLeft01Icon);
export const Search = /*#__PURE__*/ iconOf("Search", Search01Icon);
export const Trash2 = /*#__PURE__*/ iconOf("Trash2", Delete02Icon);
export const X = /*#__PURE__*/ iconOf("X", Cancel01Icon);
export const XSquare = /*#__PURE__*/ iconOf("XSquare", CancelSquareIcon);

// Search modifiers
export const CaseSensitive = /*#__PURE__*/ iconOf("CaseSensitive", CaseSensitiveIcon);
export const Regex = /*#__PURE__*/ iconOf("Regex", RegexIcon);
export const WholeWord = /*#__PURE__*/ iconOf("WholeWord", TextSquareIcon);

// Files
export const File = /*#__PURE__*/ iconOf("File", FileEmpty02Icon);
export const FileArchive = /*#__PURE__*/ iconOf("FileArchive", FileArchiveIcon);
export const FileAudio = /*#__PURE__*/ iconOf("FileAudio", FileAudioIcon);
export const FileBadge = /*#__PURE__*/ iconOf("FileBadge", FileBadgeIcon);
export const FileCode = /*#__PURE__*/ iconOf("FileCode", FileCodeIcon);
export const FileCog = /*#__PURE__*/ iconOf("FileCog", FileCogIcon);
export const FileDown = /*#__PURE__*/ iconOf("FileDown", FileDownIcon);
export const FileImage = /*#__PURE__*/ iconOf("FileImage", FileImageIcon);
export const FileJson = /*#__PURE__*/ iconOf("FileJson", FileBracesIcon);
export const FileKey = /*#__PURE__*/ iconOf("FileKey", FileKeyIcon);
export const FileLock2 = /*#__PURE__*/ iconOf("FileLock2", FileLockedIcon);
export const FilePlus = /*#__PURE__*/ iconOf("FilePlus", FilePlusIcon);
export const FileSpreadsheet = /*#__PURE__*/ iconOf("FileSpreadsheet", FileSpreadsheetIcon);
export const FileTerminal = /*#__PURE__*/ iconOf("FileTerminal", FileTerminalIcon);
export const FileText = /*#__PURE__*/ iconOf("FileText", File02Icon);
export const FileType = /*#__PURE__*/ iconOf("FileType", FileTypeIcon);
export const FileType2 = /*#__PURE__*/ iconOf("FileType2", Pdf02Icon);
export const FileVideo = /*#__PURE__*/ iconOf("FileVideo", FileVideoIcon);
export const Binary = /*#__PURE__*/ iconOf("Binary", BinaryIcon);

// Folders
export const Folder = /*#__PURE__*/ iconOf("Folder", Folder01Icon);
export const FolderArchive = /*#__PURE__*/ iconOf("FolderArchive", FolderArchiveIcon);
export const FolderClosed = /*#__PURE__*/ iconOf("FolderClosed", FolderFileStorageIcon);
export const FolderCog = /*#__PURE__*/ iconOf("FolderCog", FolderCogIcon);
export const FolderGit2 = /*#__PURE__*/ iconOf("FolderGit2", FolderGitTwoIcon);
export const FolderInput = /*#__PURE__*/ iconOf("FolderInput", FolderInputIcon);
export const FolderLock = /*#__PURE__*/ iconOf("FolderLock", FolderLockedIcon);
export const FolderOpen = /*#__PURE__*/ iconOf("FolderOpen", FolderOpenIcon);
export const FolderPlus = /*#__PURE__*/ iconOf("FolderPlus", FolderAddIcon);
export const FolderSearch = /*#__PURE__*/ iconOf("FolderSearch", FolderSearchIcon);

// Git / VCS
export const GitBranch = /*#__PURE__*/ iconOf("GitBranch", GitBranchIcon);
export const GitCompare = /*#__PURE__*/ iconOf("GitCompare", GitCompareIcon);
export const Github = /*#__PURE__*/ iconOf("Github", GithubIcon);

// Images
export const ImageOff = /*#__PURE__*/ iconOf("ImageOff", ImageNotFound01Icon);
export const ImagePlus = /*#__PURE__*/ iconOf("ImagePlus", ImageAdd01Icon);

// App chrome / panels
export const LayoutPanelLeft = /*#__PURE__*/ iconOf("LayoutPanelLeft", LayoutLeftIcon);
export const PanelLeftClose = /*#__PURE__*/ iconOf("PanelLeftClose", PanelLeftCloseIcon);
export const PanelLeftOpen = /*#__PURE__*/ iconOf("PanelLeftOpen", PanelLeftOpenIcon);
export const PanelRightClose = /*#__PURE__*/ iconOf("PanelRightClose", PanelRightCloseIcon);
export const PanelRightOpen = /*#__PURE__*/ iconOf("PanelRightOpen", PanelRightOpenIcon);

// Settings / preferences
export const Gauge = /*#__PURE__*/ iconOf("Gauge", GaugeIcon);
export const Keyboard = /*#__PURE__*/ iconOf("Keyboard", KeyboardIcon);
export const Moon = /*#__PURE__*/ iconOf("Moon", MoonIcon);
export const Palette = /*#__PURE__*/ iconOf("Palette", PaintBoardIcon);
export const PersonStanding = /*#__PURE__*/ iconOf("PersonStanding", AccessibilityIcon);
export const Settings = /*#__PURE__*/ iconOf("Settings", Settings01Icon);
export const Settings2 = /*#__PURE__*/ iconOf("Settings2", SlidersHorizontalIcon);
export const Shapes = /*#__PURE__*/ iconOf("Shapes", ShapesIcon);
export const Sliders = /*#__PURE__*/ iconOf("Sliders", SlidersVerticalIcon);
export const Sun = /*#__PURE__*/ iconOf("Sun", Sun03Icon);
export const Wrench = /*#__PURE__*/ iconOf("Wrench", Wrench01Icon);

// Terminal
export const Square = /*#__PURE__*/ iconOf("Square", SquareIcon);
export const SquareTerminal = /*#__PURE__*/ iconOf("SquareTerminal", ComputerTerminal01Icon);
export const TerminalSquare = SquareTerminal;
export const Terminal = /*#__PURE__*/ iconOf("Terminal", TerminalIcon);

// Misc
export const Sparkles = /*#__PURE__*/ iconOf("Sparkles", SparklesIcon);
export const Hash = /*#__PURE__*/ iconOf("Hash", HashIcon);
export const Database = /*#__PURE__*/ iconOf("Database", DatabaseIcon);
export const Laptop = /*#__PURE__*/ iconOf("Laptop", LaptopIcon);

// Project glyphs (picker choices in ProjectContextMenu)
export const Code = /*#__PURE__*/ iconOf("Code", CodeIcon);
export const Code2 = /*#__PURE__*/ iconOf("Code2", SourceCodeIcon);
export const Server = /*#__PURE__*/ iconOf("Server", ServerStack01Icon);
export const Cloud = /*#__PURE__*/ iconOf("Cloud", CloudIcon);
export const Globe = /*#__PURE__*/ iconOf("Globe", GlobeIcon);
export const Cpu = /*#__PURE__*/ iconOf("Cpu", CpuIcon);
export const Layers = /*#__PURE__*/ iconOf("Layers", Layers01Icon);
export const Boxes = /*#__PURE__*/ iconOf("Boxes", BoxesIcon);
export const Package = /*#__PURE__*/ iconOf("Package", PackageIcon);
export const BookOpen = /*#__PURE__*/ iconOf("BookOpen", BookOpen01Icon);
export const Briefcase = /*#__PURE__*/ iconOf("Briefcase", Briefcase01Icon);
export const Zap = /*#__PURE__*/ iconOf("Zap", ZapIcon);
export const Star = /*#__PURE__*/ iconOf("Star", StarIcon);
export const Heart = /*#__PURE__*/ iconOf("Heart", HeartIcon);
export const Coffee = /*#__PURE__*/ iconOf("Coffee", Coffee02Icon);
export const Rocket = /*#__PURE__*/ iconOf("Rocket", RocketIcon);
export const Beaker = /*#__PURE__*/ iconOf("Beaker", BeakerIcon);
export const Compass = /*#__PURE__*/ iconOf("Compass", CompassIcon);
export const Image = /*#__PURE__*/ iconOf("Image", Image02Icon);
export const Music = /*#__PURE__*/ iconOf("Music", MusicNote01Icon);
export const Video = /*#__PURE__*/ iconOf("Video", Video01Icon);
export const Smartphone = /*#__PURE__*/ iconOf("Smartphone", SmartPhone01Icon);
export const Monitor = /*#__PURE__*/ iconOf("Monitor", ComputerIcon);
export const Activity = /*#__PURE__*/ iconOf("Activity", Activity01Icon);
export const Target = /*#__PURE__*/ iconOf("Target", Target01Icon);
export const PenTool = /*#__PURE__*/ iconOf("PenTool", PenTool01Icon);

// AI (project glyphs + agent surfaces)
export const Bot = /*#__PURE__*/ iconOf("Bot", BotIcon);
export const Robot = /*#__PURE__*/ iconOf("Robot", Robot01Icon);
export const AiBrain = /*#__PURE__*/ iconOf("AiBrain", AiBrain01Icon);
export const AiChip = /*#__PURE__*/ iconOf("AiChip", AiChipIcon);
export const AiMagic = /*#__PURE__*/ iconOf("AiMagic", AiMagicIcon);
export const AiNetwork = /*#__PURE__*/ iconOf("AiNetwork", AiNetworkIcon);
export const AiProgramming = /*#__PURE__*/ iconOf("AiProgramming", AiProgrammingIcon);
export const AiGenerative = /*#__PURE__*/ iconOf("AiGenerative", AiGenerativeIcon);
