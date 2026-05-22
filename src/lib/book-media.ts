import tehranImg from "@/assets/scene-tehran.jpg";
import princeImg from "@/assets/scene-prince.jpg";
import desertImg from "@/assets/scene-desert.jpg";
import farmImg from "@/assets/scene-farm.jpg";
import heroImg from "@/assets/hero-book.jpg";
import medHeart from "@/assets/med-heart.jpg";
import medBrain from "@/assets/med-brain.jpg";
import medCell from "@/assets/med-cell.jpg";
import medDna from "@/assets/med-dna.jpg";
import medSkeleton from "@/assets/med-skeleton.jpg";
import medLungs from "@/assets/med-lungs.jpg";
import medNeuron from "@/assets/med-neuron.jpg";
import medBlood from "@/assets/med-blood.jpg";
import medCoverAnatomy from "@/assets/med-cover-anatomy.jpg";
import medCoverNeuro from "@/assets/med-cover-neuro.jpg";
import hemoCells from "@/assets/hemo-cells.jpg";
import hemoBloodSmear from "@/assets/hemo-blood-smear.jpg";
import hemoSickleDiagram from "@/assets/hemo-sickle-diagram.jpg";
import hemoCover from "@/assets/hemo-cover.jpg";
import hemoChart from "@/assets/hemo-chart.jpg";
import pathSickleSmear from "@/assets/path-sickle-smear.jpg";
import pathAmlBlasts from "@/assets/path-aml-blasts.jpg";
import pathAllBlasts from "@/assets/path-all-blasts.jpg";
import pathSmearTechnique from "@/assets/path-smear-technique.jpg";
import pathNormalSmear from "@/assets/path-normal-smear.jpg";
import pathMarrowBiopsy from "@/assets/path-marrow-biopsy.jpg";

const mediaMap: Record<string, string> = {
  tehran: tehranImg,
  prince: princeImg,
  desert: desertImg,
  farm: farmImg,
  hero: heroImg,
  "med-heart": medHeart,
  "med-brain": medBrain,
  "med-cell": medCell,
  "med-dna": medDna,
  "med-skeleton": medSkeleton,
  "med-lungs": medLungs,
  "med-neuron": medNeuron,
  "med-blood": medBlood,
  "med-cover-anatomy": medCoverAnatomy,
  "med-cover-neuro": medCoverNeuro,
  "hemo-cells": hemoCells,
  "hemo-blood-smear": hemoBloodSmear,
  "hemo-sickle-diagram": hemoSickleDiagram,
  "hemo-cover": hemoCover,
  "hemo-chart": hemoChart,
  "path-sickle-smear": pathSickleSmear,
  "path-aml-blasts": pathAmlBlasts,
  "path-all-blasts": pathAllBlasts,
  "path-smear-technique": pathSmearTechnique,
  "path-normal-smear": pathNormalSmear,
  "path-marrow-biopsy": pathMarrowBiopsy,
};

/* ----------------- Offline asset blob-URL registry -----------------
 * The Reader pre-decrypts a book's stored assets and registers their blob
 * URLs here, keyed by either the `offline-asset://<bookId>/<key>` URL OR the
 * original remote URL (so covers in the Library also resolve offline). */
const offlineUrlMap = new Map<string, string>();
export const registerOfflineBlobUrl = (offlineUrl: string, blobUrl: string) => {
  offlineUrlMap.set(offlineUrl, blobUrl);
};
export const unregisterOfflineBlobUrls = (bookId?: string) => {
  if (!bookId) { offlineUrlMap.clear(); return; }
  const prefix = `offline-asset://${bookId}/`;
  for (const k of Array.from(offlineUrlMap.keys())) {
    if (k.startsWith(prefix)) offlineUrlMap.delete(k);
  }
};
export const hasOfflineBlobUrl = (offlineUrl: string) => offlineUrlMap.has(offlineUrl);

export const resolveBookMedia = (src: string | null | undefined) => {
  if (!src) return "";
  // Direct hit (offline-asset:// scheme, original remote URL, or any aliased key).
  const offlineHit = offlineUrlMap.get(src);
  if (offlineHit) return offlineHit;
  return mediaMap[src] || src;
};

export const resolveBookCover = (
  src: string | null | undefined,
  opts: { width?: number; height?: number; quality?: number; resize?: "cover" | "contain" | "fill" } = {},
): string => {
  const resolved = resolveBookMedia(src);
  if (!resolved) return "";
  // blob: URLs (offline cached covers) shouldn't be sent through the resize endpoint.
  if (resolved.startsWith("blob:") || resolved.startsWith("data:")) return resolved;
  const m = resolved.match(/^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/(.+)$/);
  if (!m) return resolved;
  const [, host, rest] = m;
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  params.set("quality", String(opts.quality ?? 70));
  params.set("resize", opts.resize ?? "cover");
  const path = rest.split("?")[0];
  return `${host}/storage/v1/render/image/public/${path}?${params.toString()}`;
};
