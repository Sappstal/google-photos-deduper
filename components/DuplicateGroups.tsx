import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Card from "@mui/material/Card"
import CardActionArea from "@mui/material/CardActionArea"
import CardContent from "@mui/material/CardContent"
import CardMedia from "@mui/material/CardMedia"
import Checkbox from "@mui/material/Checkbox"
import Chip from "@mui/material/Chip"
import IconButton from "@mui/material/IconButton"
import Paper from "@mui/material/Paper"
import Skeleton from "@mui/material/Skeleton"
import Typography from "@mui/material/Typography"
import OpenInFullIcon from "@mui/icons-material/OpenInFull"
import OpenInNewIcon from "@mui/icons-material/OpenInNew"
import StarIcon from "@mui/icons-material/Star"
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep"
import PlaceIcon from "@mui/icons-material/Place"
import FolderSpecialIcon from "@mui/icons-material/FolderSpecial"
import Tooltip from "@mui/material/Tooltip"
import { useBlobUrl } from "./useBlobUrl"
import { PhotoViewerModal } from "./PhotoViewerModal"
import { buildThumbUrl } from "../lib/photo-url"
import type { GpdMediaItem, DuplicateGroup } from "../lib/types"
import { isWholeGroupTrashed } from "../lib/kept-overrides"

function formatBytes(bytes?: number): string | null {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(2)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function formatLocation(item: GpdMediaItem): string | null {
  if (item.locationName) return item.locationName
  if (item.coordinates && item.coordinates.length === 2) {
    return `${item.coordinates[0].toFixed(4)}, ${item.coordinates[1].toFixed(4)}`
  }
  return null
}

const PAGE_SIZE = 30

/**
 * Label a group as "videos", "photos", or "items" depending on the kinds of
 * media inside. Groups with both kinds (rare, only possible if a video's
 * poster happens to match a still) fall back to the neutral "items".
 */
function groupItemKind(
  group: DuplicateGroup,
  mediaItems: Record<string, GpdMediaItem>,
): string {
  let videos = 0
  let total = 0
  for (const key of group.mediaKeys) {
    const item = mediaItems[key]
    if (!item) continue
    total++
    if (item.duration) videos++
  }
  if (total === 0) return "items"
  if (videos === total) return total === 1 ? "video" : "videos"
  if (videos === 0) return total === 1 ? "photo" : "photos"
  return "items"
}

// ── Hoisted static sx objects ──────────────────────────────────────────
const sxPaperBase = { mb: 2, overflow: "hidden", borderRadius: 2, transition: "opacity 0.15s" }
const sxGroupHeader = {
  display: "flex",
  alignItems: "center",
  px: 1.5,
  py: 1,
  backgroundColor: "grey.50",
  borderBottom: "1px solid",
  borderColor: "divider",
  cursor: "pointer",
  userSelect: "none",
}
const sxCheckbox = { p: 0.5, mr: 0.5 }
const sxChipSimilarity = { fontSize: 11 }
const sxThumbnailsWrapper = { display: "flex", flexWrap: "wrap", gap: 1.5, p: 1.5 }
const sxItemWrapper = {
  position: "relative",
  width: 220,
  flexShrink: 0,
  "& .viewer-btn": { opacity: 0 },
  "&:hover .viewer-btn": { opacity: 1 },
}
const sxCardBase = { width: "100%", transition: "border-color 0.15s, opacity 0.15s" }
const sxCardContent = { p: 1, "&:last-child": { pb: 1 }, display: "flex", flexDirection: "column", gap: 0.4 }
const sxViewerBtn = {
  position: "absolute",
  top: 4,
  right: 4,
  bgcolor: "rgba(0,0,0,0.45)",
  color: "white",
  transition: "opacity 0.15s",
  minWidth: 30,
  minHeight: 30,
  "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
}
const sxExternalLinkBtn = {
  position: "absolute",
  top: 4,
  right: 38,
  bgcolor: "rgba(0,0,0,0.45)",
  color: "white",
  transition: "opacity 0.15s",
  minWidth: 30,
  minHeight: 30,
  "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
}
const sxOpenInFullIcon = { fontSize: 14 }
// Mirrors sxViewerBtn's translucent pill so the two overlays read as one
// language, but sits top-left since the zoom button owns top-right.
const sxFavoriteBadge = {
  position: "absolute",
  top: 4,
  left: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: "50%",
  bgcolor: "rgba(0,0,0,0.45)",
  color: "#FFC107",
  pointerEvents: "none",
}
const sxFavoriteIcon = { fontSize: 15 }
const sxStatusChip = { width: "fit-content", height: 20, fontSize: 11 }
// ──────────────────────────────────────────────────────────────────────

function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { blobUrl } = useBlobUrl(visible ? src : undefined)

  return (
    <div ref={ref}>
      {blobUrl ? (
        <CardMedia
          component="img"
          image={blobUrl}
          alt={alt}
          sx={{ height: 120, objectFit: "cover" }}
        />
      ) : (
        <Skeleton variant="rectangular" height={120} animation="wave" />
      )}
    </div>
  )
}

interface DuplicateGroupRowProps {
  group: DuplicateGroup
  mediaItems: Record<string, GpdMediaItem>
  isSelected: boolean
  keptSet: Set<string>
  onToggleGroup: (groupId: string) => void
  onToggleKept: (group: DuplicateGroup, mediaKey: string) => void
  onTrashWholeGroup: (group: DuplicateGroup) => void
  onOpenViewer: (group: DuplicateGroup, index: number) => void
  onMouseEnterPhoto: (group: DuplicateGroup, index: number) => void
  onMouseLeavePhoto: () => void
}

const DuplicateGroupRow = memo(function DuplicateGroupRow({
  group,
  mediaItems,
  isSelected,
  keptSet,
  onToggleGroup,
  onToggleKept,
  onTrashWholeGroup,
  onOpenViewer,
  onMouseEnterPhoto,
  onMouseLeavePhoto,
}: DuplicateGroupRowProps) {
  const allTrashed = isWholeGroupTrashed(keptSet)
  return (
    <Paper
      variant="outlined"
      sx={[sxPaperBase, { opacity: isSelected ? 1 : 0.55 }]}>
      {/* Group header */}
      <Box
        onClick={() => onToggleGroup(group.id)}
        sx={sxGroupHeader}>
        <Checkbox
          size="small"
          checked={isSelected}
          onChange={() => onToggleGroup(group.id)}
          onClick={(e) => e.stopPropagation()}
          sx={sxCheckbox}
        />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {group.mediaKeys.length} {groupItemKind(group, mediaItems)}
        </Typography>
        <Chip
          label={`${Math.round(group.similarity * 100)}% similar`}
          size="small"
          variant="outlined"
          sx={sxChipSimilarity}
        />
        <Tooltip
          title={
            allTrashed
              ? "Keep the best photo again"
              : "Trash every photo in this group"
          }>
          {/* stopPropagation: the header itself toggles group selection */}
          <IconButton
            size="small"
            data-testid={`trash-whole-group-${group.id}`}
            aria-label={
              allTrashed
                ? "Keep the best photo in this group"
                : "Trash every photo in this group"
            }
            aria-pressed={allTrashed}
            color={allTrashed ? "error" : "default"}
            onClick={(e) => {
              e.stopPropagation()
              onTrashWholeGroup(group)
            }}>
            <DeleteSweepIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Thumbnails */}
      <Box sx={sxThumbnailsWrapper}>
        {group.mediaKeys.map((key, itemIndex) => {
          const item = mediaItems[key]
          if (!item) return null
          const isKept = keptSet.has(key)

          return (
            <Box
              key={key}
              sx={sxItemWrapper}
              onMouseEnter={() => onMouseEnterPhoto(group, itemIndex)}
              onMouseLeave={() => onMouseLeavePhoto()}>
              <Card
                variant="outlined"
                sx={[sxCardBase, {
                  borderColor: isKept ? "primary.main" : "divider",
                  borderWidth: isKept ? 2 : 1,
                }]}>
                <CardActionArea onClick={() => onToggleKept(group, key)}>
                  <ThumbnailImage
                    src={buildThumbUrl(item.thumb, { height: 200 })}
                    alt={item.fileName || item.mediaKey}
                  />
                  <CardContent sx={sxCardContent}>
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      display="block"
                      noWrap
                      title={item.fileName || item.mediaKey}>
                      {item.fileName || "Loading filename..."}
                    </Typography>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                      {item.resWidth && item.resHeight && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: "monospace", fontSize: 11 }}>
                          {item.resWidth}×{item.resHeight}
                        </Typography>
                      )}
                      {formatBytes(item.size) && (
                        <Chip
                          label={formatBytes(item.size)}
                          size="small"
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10, fontFamily: "monospace", "& .MuiChip-label": { px: 0.75 } }}
                        />
                      )}
                      {item.isOriginalQuality !== null && item.isOriginalQuality !== undefined && (
                        <Chip
                          label={item.isOriginalQuality ? "Original" : "Storage Saver"}
                          size="small"
                          color={item.isOriginalQuality ? "success" : "default"}
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.6 } }}
                        />
                      )}
                    </Box>

                    {item.timestamp ? (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: 11 }}>
                        <span style={{ opacity: 0.65 }}>Taken </span>
                        {new Date(item.timestamp).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        <span style={{ opacity: 0.7 }}>
                          {new Date(item.timestamp).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Typography>
                    ) : null}
                    {item.creationTimestamp ? (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: 11 }}>
                        <span style={{ opacity: 0.65 }}>Uploaded </span>
                        {new Date(item.creationTimestamp).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </Typography>
                    ) : null}

                    {/* Location */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, minWidth: 0 }}>
                      <PlaceIcon sx={{ fontSize: 12, color: formatLocation(item) ? "primary.main" : "text.disabled", flexShrink: 0 }} />
                      <Typography
                        variant="caption"
                        color={formatLocation(item) ? "text.primary" : "text.disabled"}
                        noWrap
                        sx={{ fontSize: 11 }}
                        title={formatLocation(item) || "No GPS location"}>
                        {formatLocation(item) || "No GPS location"}
                      </Typography>
                    </Box>

                    {/* Albums */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, flexWrap: "wrap", mt: 0.2 }}>
                      <FolderSpecialIcon sx={{ fontSize: 12, color: item.albums?.length ? "secondary.main" : "text.disabled", flexShrink: 0 }} />
                      {item.albums && item.albums.length > 0 ? (
                        item.albums.map((albumTitle) => (
                          <Chip
                            key={albumTitle}
                            label={albumTitle}
                            size="small"
                            color="secondary"
                            variant="outlined"
                            title={albumTitle}
                            sx={{
                              height: 18,
                              fontSize: 10,
                              maxWidth: 185,
                              "& .MuiChip-label": { px: 0.75, overflow: "hidden", textOverflow: "ellipsis" },
                            }}
                          />
                        ))
                      ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
                          {item.extLoaded ? "No album (Main Library)" : "Loading albums..."}
                        </Typography>
                      )}
                      {item.isArchived && (
                        <Chip
                          label="Archived"
                          size="small"
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.6 } }}
                        />
                      )}
                    </Box>

                    <Box sx={{ pt: 0.4 }}>
                      {isKept ? (
                        <Chip
                          label="Keep"
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={sxStatusChip}
                        />
                      ) : isSelected ? (
                        <Chip
                          label="Trash"
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={sxStatusChip}
                        />
                      ) : null}
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>

              {/*
                Favorite marker. Purely informational — it reports Google
                Photos state we cannot change from here, so it is not a
                control and does not swallow the card's keep/trash click.
              */}
              {item.isFavorite === true && (
                <Box
                  sx={sxFavoriteBadge}
                  data-testid={`favorite-badge-${key}`}
                  title="Favorite in Google Photos — kept by default"
                  aria-label="Favorite in Google Photos">
                  <StarIcon sx={sxFavoriteIcon} />
                </Box>
              )}

              {/* Open in Google Photos button */}
              {item.productUrl && (
                <IconButton
                  className="viewer-btn"
                  size="small"
                  component="a"
                  href={item.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open in Google Photos"
                  title="Open in Google Photos"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  sx={sxExternalLinkBtn}>
                  <OpenInNewIcon sx={sxOpenInFullIcon} />
                </IconButton>
              )}

              {/* Zoom overlay — secondary action, does not trigger Keep toggle */}
              <IconButton
                className="viewer-btn"
                size="small"
                aria-label="View full size"
                title="View full size"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenViewer(group, itemIndex)
                }}
                sx={sxViewerBtn}>
                <OpenInFullIcon sx={sxOpenInFullIcon} />
              </IconButton>
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
})

interface DuplicateGroupsProps {
  groups: DuplicateGroup[]
  mediaItems: Record<string, GpdMediaItem>
  selectedGroupIds: Set<string>
  onToggleGroup: (groupId: string) => void
  keptByGroupId: Map<string, Set<string>>
  onToggleKept: (group: DuplicateGroup, mediaKey: string) => void
  onTrashWholeGroup: (group: DuplicateGroup) => void
  onRequestExtendedInfo?: (mediaKeys: string[]) => void
  /**
   * Timestamp buckets split during the scan to keep pairwise comparison
   * bounded. Above zero, results are incomplete and we say so.
   */
  bucketsSplit?: number
}

export function DuplicateGroups({
  groups,
  mediaItems,
  selectedGroupIds,
  onToggleGroup,
  keptByGroupId,
  onToggleKept,
  onTrashWholeGroup,
  onRequestExtendedInfo,
  bucketsSplit = 0,
}: DuplicateGroupsProps) {
  // Measure time from first non-empty groups render to commit
  const renderLoggedRef = useRef(false)
  const renderStartRef = useRef<number | null>(null)
  if (groups.length > 0 && !renderLoggedRef.current && renderStartRef.current === null) {
    renderStartRef.current = performance.now()
  }
  useEffect(() => {
    if (renderLoggedRef.current || renderStartRef.current === null || groups.length === 0) return
    renderLoggedRef.current = true
    const elapsed = performance.now() - renderStartRef.current
    const totalThumbnails = groups.reduce((s, g) => s + g.mediaKeys.length, 0)
    console.log(
      `[GPD perf] Results render: ${elapsed.toFixed(0)}ms for ${groups.length} groups, ${totalThumbnails} thumbnails`
    )
  })

  const [viewerState, setViewerState] = useState<{
    group: DuplicateGroup
    index: number
  } | null>(null)
  const hoveredPhotoRef = useRef<{
    group: DuplicateGroup
    index: number
  } | null>(null)

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Reset pagination when groups change (new scan)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [groups])

  // Request extended metadata (real fileName, size in MB, GPS location, Albums) for visible groups
  const requestedExtKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!onRequestExtendedInfo || groups.length === 0) return
    const visibleGroups = groups.slice(0, visibleCount + 15)
    const keysToFetch: string[] = []
    for (const g of visibleGroups) {
      for (const k of g.mediaKeys) {
        const item = mediaItems[k]
        if (item && !item.extLoaded && !requestedExtKeysRef.current.has(k)) {
          requestedExtKeysRef.current.add(k)
          keysToFetch.push(k)
        }
      }
    }
    if (keysToFetch.length > 0) {
      onRequestExtendedInfo(keysToFetch)
    }
  }, [groups, visibleCount, mediaItems, onRequestExtendedInfo])

  // Infinite scroll: observe sentinel once per groups identity.
  // Functional setState needs no visibleCount in the closure.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisibleCount((c) => c + PAGE_SIZE)
      },
      { rootMargin: "400px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [groups])

  const onOpenViewer = useCallback((group: DuplicateGroup, index: number) => {
    setViewerState({ group, index })
  }, [])

  const onMouseEnterPhoto = useCallback((group: DuplicateGroup, index: number) => {
    hoveredPhotoRef.current = { group, index }
  }, [])

  const onMouseLeavePhoto = useCallback(() => {
    hoveredPhotoRef.current = null
  }, [])

  // Spacebar key opens preview for the photo under the cursor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " && hoveredPhotoRef.current && !viewerState) {
        e.preventDefault()
        onOpenViewer(hoveredPhotoRef.current.group, hoveredPhotoRef.current.index)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [viewerState, onOpenViewer])

  const currentGroupIndex = useMemo(() => {
    return viewerState
      ? groups.findIndex((g) => g.id === viewerState.group.id)
      : -1
  }, [viewerState, groups])

  const handleNextGroup = useCallback(() => {
    if (currentGroupIndex !== -1 && currentGroupIndex < groups.length - 1) {
      setViewerState({ group: groups[currentGroupIndex + 1], index: 0 })
    }
  }, [currentGroupIndex, groups])

  const handlePrevGroup = useCallback(() => {
    if (currentGroupIndex > 0) {
      setViewerState({ group: groups[currentGroupIndex - 1], index: 0 })
    }
  }, [currentGroupIndex, groups])

  const viewerItems = useMemo(() => {
    if (!viewerState) return []
    return viewerState.group.mediaKeys
      .map((k) => mediaItems[k])
      .filter((item): item is GpdMediaItem => !!item)
  }, [viewerState, mediaItems])

  const nextGroupItems = useMemo(() => {
    if (!viewerState || currentGroupIndex === -1 || currentGroupIndex >= groups.length - 1) return []
    const nextGroup = groups[currentGroupIndex + 1]
    return nextGroup.mediaKeys
      .map((k) => mediaItems[k])
      .filter((item): item is GpdMediaItem => !!item)
  }, [viewerState, currentGroupIndex, groups, mediaItems])

  if (groups.length === 0) {
    const totalItems = Object.keys(mediaItems).length
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          No duplicates found
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Scanned {totalItems.toLocaleString()} items. No duplicate groups
          detected at the current similarity threshold.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ pb: 6 }}>
      <Typography variant="h6" fontWeight={600} sx={{ px: 0, py: 2 }}>
        {groups.length} Duplicate Group{groups.length !== 1 ? "s" : ""} Found
      </Typography>

      {bucketsSplit > 0 && (
        <Alert severity="info" data-testid="split-buckets-notice" sx={{ mb: 2 }}>
          {bucketsSplit} large time {bucketsSplit === 1 ? "group was" : "groups were"} split
          to keep the scan fast — duplicates spanning a split may be missed. Narrow the
          time window to compare fewer photos at once.
        </Alert>
      )}

      {groups.slice(0, visibleCount).map((group) => (
        <DuplicateGroupRow
          key={group.id}
          group={group}
          mediaItems={mediaItems}
          isSelected={selectedGroupIds.has(group.id)}
          keptSet={keptByGroupId.get(group.id)!}
          onToggleGroup={onToggleGroup}
          onToggleKept={onToggleKept}
          onTrashWholeGroup={onTrashWholeGroup}
          onOpenViewer={onOpenViewer}
          onMouseEnterPhoto={onMouseEnterPhoto}
          onMouseLeavePhoto={onMouseLeavePhoto}
        />
      ))}

      {/* Infinite scroll sentinel */}
      {visibleCount < groups.length && <div ref={sentinelRef} />}

      {/* Photo viewer modal — rendered once outside the map, state drives which photo */}
      {viewerState && (
        <PhotoViewerModal
          open={true}
          items={viewerItems}
          nextGroupItems={nextGroupItems}
          initialIndex={viewerState.index}
          keptSet={keptByGroupId.get(viewerState.group.id)!}
          isGroupSelected={selectedGroupIds.has(viewerState.group.id)}
          onClose={() => setViewerState(null)}
          onToggleKept={(mediaKey) => onToggleKept(viewerState.group, mediaKey)}
          onToggleGroup={() => onToggleGroup(viewerState.group.id)}
          onNextGroup={handleNextGroup}
          onPrevGroup={handlePrevGroup}
        />
      )}
    </Box>
  )
}
