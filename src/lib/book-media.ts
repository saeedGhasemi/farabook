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
};

export const resolveBookMedia = (src: string | null | undefined) => (src ? mediaMap[src] || src : "");