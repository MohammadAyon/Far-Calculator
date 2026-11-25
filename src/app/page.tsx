"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Layers3,
  Mail,
  MapPin,
  Phone,
  Printer,
  Search,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  areaUnits,
  emptyRuleDataset,
  feetPerMeter,
  sqftPerSqm,
  type CalculationResult,
  type ReportSection,
  type RuleDataset,
} from "@/lib/rules";
import { nearestMrtStation } from "@/lib/mrt";
import LayoutEngine from "@/components/layout-engine";

const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>,
});

const foundrio = {
  name: "Foundrio Design & Consultant",
  site: "https://foundrio-bd.com",
  phone: "01813-366009",
  tel: "tel:+8801813366009",
  email: "foundriodesign@foundrio-bd.com",
  address: "House-21, Road-17, Banani C/A, Dhaka-1213",
  facebook: "https://www.facebook.com/foundrio.bd",
};

type ApiError = {
  error?: string;
  issues?: Array<{ path: string; message: string }>;
};

type OccupancyShare = { code: string; sharePercent: number };
type ResultTab = "far" | "design" | "parking";
type BlockFilter = "all" | "planned" | "spontaneous";
type FieldErrors = Record<string, string>;

const resultSections: Record<ResultTab, ReportSection[]> = {
  far: ["far", "groundCoverage", "setbacks"],
  design: ["layout"],
  parking: ["parking", "stairsElevator"],
};

const resultSectionLabels: Record<ReportSection, string> = {
  far: "FAR assessment",
  groundCoverage: "Ground coverage & open space",
  setbacks: "Setbacks & clearances",
  layout: "Building layout",
  parking: "Parking",
  stairsElevator: "Stairs & lifts",
};

const areaLabel: Record<string, string> = {
  sqft: "sq ft",
  katha: "katha",
  sqm: "sq m",
  decimal: "decimal",
  chatak: "chatak",
  bigha: "bigha",
  acre: "acre",
  hectare: "hectare",
};

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function areaToSqft(
  value: string,
  unit: (typeof areaUnits)[number]["value"],
  dataset: RuleDataset,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (unit === "sqft") return parsed;
  const factor =
    unit === "sqm" ? sqftPerSqm : dataset.areaUnitSqft?.[unit];
  return factor ? parsed * factor : null;
}

function amountWithUnit(value: number | null, unit?: string, precision = 2) {
  if (value === null) return "Not applicable";
  const formatted = formatNumber(value, precision);
  return unit ? `${formatted} ${unit}` : formatted;
}

function resultSummary(result: CalculationResult) {
  const where = `${formatNumber(result.plotAreaSqft / 720, 1)} katha in ${result.blockLabel}`;
  const building = result.buildingSummary;
  return building
    ? `That is about G+${building.upperFloors} (${building.storeys} storeys) with ${building.totalUnits} apartments of ~${formatNumber(building.unitSizeSqft, 0)} sq ft and ${building.carsRequired} car parking, on ${where}.`
    : `Total floor area allowed for ${result.occupancyLabels.join(" / ")} on ${where}.`;
}

function resultErrorMessage(body: ApiError) {
  const detail = body.issues?.length
    ? ` ${body.issues
        .slice(0, 3)
        .map((issue) => `${issue.path || "file"}: ${issue.message}`)
        .join("; ")}`
    : "";
  return `${body.error ?? "The request could not be completed."}${detail}`;
}

export default function Home() {
  const [dataset, setDataset] = useState<RuleDataset>(emptyRuleDataset);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [areaValue, setAreaValue] = useState("");
  const [areaUnit, setAreaUnit] =
    useState<(typeof areaUnits)[number]["value"]>("sqft");
  const [existingRoadFt, setExistingRoadFt] = useState("");
  const [proposedRoadFt, setProposedRoadFt] = useState("");
  const [frontageFt, setFrontageFt] = useState("");
  const [roadWideningNotPossible, setRoadWideningNotPossible] = useState(false);
  const [surrenderedValue, setSurrenderedValue] = useState("0");
  const [surrenderedUnit, setSurrenderedUnit] =
    useState<(typeof areaUnits)[number]["value"]>("sqft");
  const [blockId, setBlockId] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [showMap, setShowMap] = useState(false);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [occupancyMode, setOccupancyMode] = useState<"single" | "mixed">("single");
  const [occupancyShares, setOccupancyShares] = useState<OccupancyShare[]>([]);
  const [zoneOverride, setZoneOverride] = useState("");
  const [incentiveIds, setIncentiveIds] = useState<string[]>([]);
  const [designValues, setDesignValues] = useState<Record<string, number>>({});
  const [hardLocks, setHardLocks] = useState<string[]>([]);
  const [manualFarEnabled, setManualFarEnabled] = useState(false);
  const [manualFar, setManualFar] = useState("");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("far");
  const [isCalculating, setIsCalculating] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const selectedBlock = useMemo(
    () => dataset.blocks.find((block) => block.id === blockId),
    [blockId, dataset.blocks],
  );
  const zones = useMemo(
    () =>
      Array.from(
        new Set(
          dataset.blocks.flatMap((block) => [
            ...(block.zone ? [block.zone] : []),
            ...Object.keys(block.areaFarByZone ?? {}),
          ]),
        ),
      ).sort(),
    [dataset.blocks],
  );
  const filteredBlocks = useMemo(() => {
    const query = blockSearch.trim().toLocaleLowerCase();
    return dataset.blocks.filter((block) => {
      const matchesQuery =
        !query ||
        `${block.id} ${block.label} ${block.englishName ?? ""} ${block.keywords ?? ""} ${block.zone ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      const matchesZone =
        zoneFilter === "all" ||
        block.zone === zoneFilter ||
        block.areaFarByZone?.[zoneFilter] !== undefined;
      const typeCode = block.typeCode?.toLowerCase();
      const matchesKind =
        blockFilter === "all" ||
        (blockFilter === "planned" && typeCode === "p") ||
        (blockFilter === "spontaneous" && typeCode === "s");
      return matchesQuery && matchesZone && matchesKind;
    });
  }, [blockFilter, blockSearch, dataset.blocks, zoneFilter]);
  const areaPreviewSqft = areaToSqft(areaValue, areaUnit, dataset);
  const surrenderedPreviewSqft = areaToSqft(
    surrenderedValue,
    surrenderedUnit,
    dataset,
  );
  const existingRoadWidthNumber = Number(existingRoadFt);
  const proposedRoadWidthNumber = Number(proposedRoadFt);
  const narrowRoadOutsideOldDhaka = Boolean(
    dataset.roadWidening &&
      selectedBlock !== undefined &&
      selectedBlock.typeCode !== "O" &&
      existingRoadWidthNumber > 0 &&
      existingRoadWidthNumber < dataset.roadWidening.minRoadWidthFt,
  );
  const mandatoryWideningRequired = Boolean(
    dataset.roadWidening &&
      existingRoadWidthNumber >= dataset.roadWidening.minRoadWidthFt &&
      existingRoadWidthNumber < dataset.roadWidening.maxRoadWidthFt,
  );
  const proposedRoadRequired =
    dataset.roadFarCombination === "proposed" ||
    narrowRoadOutsideOldDhaka ||
    (mandatoryWideningRequired && !roadWideningNotPossible);
  const surrenderedLandRequired = Boolean(
    dataset.roadWidening?.requireSurrenderOnWidening &&
      proposedRoadWidthNumber > existingRoadWidthNumber,
  );
  const hasCalculationData =
    dataset.calculationMode !== null &&
    dataset.blocks.length > 0 &&
    dataset.roadFar.length > 0 &&
    dataset.occupancies.length > 0;
  const occupancySharesTotal = occupancyShares.reduce(
    (total, item) => total + item.sharePercent,
    0,
  );
  const coreDetailsComplete = [
    Boolean(blockId),
    Boolean(
      areaPreviewSqft &&
        areaPreviewSqft > 0 &&
        Number(existingRoadFt) > 0 &&
        (!proposedRoadRequired || proposedRoadWidthNumber > 0) &&
        (!surrenderedLandRequired ||
          (surrenderedPreviewSqft !== null && surrenderedPreviewSqft > 0)),
    ),
    Boolean(
      occupancyShares.length > 0 &&
        occupancyShares.every((item) => item.code && item.sharePercent > 0) &&
        Math.abs(occupancySharesTotal - 100) <= 0.01 &&
        (occupancyMode !== "mixed" || dataset.mixedOccupancyCapMethod),
    ),
  ].filter(Boolean).length;
  const occupancyCodes = occupancyShares.map((item) => item.code);
  const selectedUsesAreAllNonResidential =
    occupancyCodes.length > 0 &&
    occupancyCodes.every(
      (code) =>
        dataset.occupancies.find((occupancy) => occupancy.code === code)
          ?.farTreatment === "road-only",
    );
  const automaticIncentives = dataset.incentives.filter(
    (item) => item.automatic,
  );
  const selectableIncentives = dataset.incentives.filter(
    (item) => !item.automatic,
  );
  const farBonusInputIds = new Set(
    dataset.incentives.flatMap((item) =>
      item.calculation?.mode === "input" ? [item.calculation.inputId] : [],
    ),
  );
  const designInputs = dataset.designInputs.filter(
    (item) => !farBonusInputIds.has(item.id),
  );
  const incentiveInputs = designInputs.filter(
    (item) => item.section === "incentives",
  );
  const layoutInputs = designInputs.filter(
    (item) => item.section === "layout",
  );
  const parkingInputs = designInputs.filter(
    (item) => item.section === "parking",
  );

  // Share links (?b=&a=&u=&r=...) restore the main inputs once the ruleset is loaded.
  function restoreFromLink(loaded: RuleDataset) {
    const q = new URLSearchParams(window.location.search);
    const unit = (value: string | null) => areaUnits.find((item) => item.value === value)?.value;
    if (q.get("b") && loaded.blocks.some((block) => block.id === q.get("b"))) setBlockId(q.get("b")!);
    if (q.get("a")) setAreaValue(q.get("a")!);
    if (unit(q.get("u"))) setAreaUnit(unit(q.get("u"))!);
    if (q.get("r")) setExistingRoadFt(q.get("r")!);
    if (q.get("p")) setProposedRoadFt(q.get("p")!);
    if (q.get("s")) setSurrenderedValue(q.get("s")!);
    if (unit(q.get("su"))) setSurrenderedUnit(unit(q.get("su"))!);
    if (q.get("f")) setFrontageFt(q.get("f")!);
    if (q.get("w") === "1") setRoadWideningNotPossible(true);
    const code = q.get("o");
    if (code && loaded.occupancies.some((item) => item.code === code)) {
      setOccupancyMode("single");
      setOccupancyShares([{ code, sharePercent: 100 }]);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/rules")
      .then(async (response) => {
        const body = (await response.json()) as
          | { dataset: RuleDataset }
          | ApiError;
        if (!response.ok || !("dataset" in body)) {
          throw new Error(
            "error" in body
              ? body.error
              : "Could not load the active rule dataset.",
          );
        }
        if (active) {
          setDataset(body.dataset);
          restoreFromLink(body.dataset);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not connect to the rule database.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingRules(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!result) return;
    document.title = `${formatNumber(result.plotAreaSqft / 720, 1)} katha in ${result.blockLabel}: ${formatNumber(result.floorAreaSqft, 0)} sq ft buildable | Foundrio FAR Calculator`;
  }, [result]);

  function shareQuery() {
    const q = new URLSearchParams({ b: blockId, a: areaValue, u: areaUnit, r: existingRoadFt });
    if (proposedRoadFt) q.set("p", proposedRoadFt);
    if (Number(surrenderedValue) > 0) { q.set("s", surrenderedValue); q.set("su", surrenderedUnit); }
    if (frontageFt) q.set("f", frontageFt);
    if (roadWideningNotPossible) q.set("w", "1");
    if (occupancyMode === "single" && occupancyShares[0]?.code) q.set("o", occupancyShares[0].code);
    return q.toString();
  }

  function shareResult() {
    const url = window.location.href;
    const text = result
      ? `My ${formatNumber(result.plotAreaSqft / 720, 1)} katha plot in ${result.blockLabel} can have about ${formatNumber(result.floorAreaSqft, 0)} sq ft of floor area (FAR ${formatNumber(result.appliedFar)}). Check yours free with the Foundrio FAR Calculator:`
      : "Check how much you can build on your plot with the Foundrio FAR Calculator:";
    if (typeof navigator.share === "function") {
      // A rejection here just means the user closed the share sheet.
      navigator.share({ title: "Foundrio FAR Calculator", text, url }).catch(() => undefined);
      return;
    }
    navigator.clipboard
      .writeText(`${text} ${url}`)
      .then(() => setNotice("Link copied. It reopens this plot's details; press Calculate to see the result."))
      .catch(() => setFormError("Could not copy the link. Copy it from the address bar instead."));
  }

  function downloadCsv() {
    if (!result) return;
    const cell = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = Object.entries(result.reportFields).flatMap(([section, fields]) =>
      [...fields, ...(section === "groundCoverage" ? siteCoverageReportFields : [])].map((field) =>
        [section, field.label, field.value === null ? "" : Number(field.value.toFixed(field.precision ?? 2)), field.unit].map(cell).join(","),
      ),
    );
    const header = [["Prepared with", `Foundrio FAR Calculator (${foundrio.site})`], ["Block", result.blockLabel], ["Applied FAR", formatNumber(result.appliedFar)], ["Floor area (sft)", formatNumber(result.floorAreaSqft, 0)]]
      .map((pair) => pair.map(cell).join(","));
    const blob = new Blob(["\uFEFF" + [...header, "", "Section,Item,Value,Unit", ...rows, "", cell(`Estimate only, not RAJUK approval. Talk to ${foundrio.name}: ${foundrio.phone}, ${foundrio.email}, ${foundrio.site}`)].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `foundrio-far-${result.blockLabel.replace(/[^\w\u0980-\u09FF]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function setOccupancySelection(code: string) {
    setOccupancyShares(code ? [{ code, sharePercent: 100 }] : []);
    setResult(null);
  }

  function changeOccupancyMode(mode: "single" | "mixed") {
    setOccupancyMode(mode);
    if (mode === "single" && occupancyShares.length > 1) {
      setOccupancyShares([
        { code: occupancyShares[0].code, sharePercent: 100 },
      ]);
    } else if (mode === "single") {
      setOccupancyShares(
        occupancyShares[0]
          ? [{ code: occupancyShares[0].code, sharePercent: 100 }]
          : [],
      );
    } else if (occupancyShares.length === 1) {
      setOccupancyShares([
        { ...occupancyShares[0], sharePercent: 50 },
        { code: "", sharePercent: 50 },
      ]);
    } else if (occupancyShares.length === 0) {
      setOccupancyShares([
        { code: "", sharePercent: 50 },
        { code: "", sharePercent: 50 },
      ]);
    }
    setResult(null);
  }

  function updateOccupancy(index: number, code: string) {
    setOccupancyShares((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index
          ? {
              ...item,
              code,
            }
          : item,
      ),
    );
    setResult(null);
  }

  function changeOccupancyShare(index: number, value: string) {
    const parsed = Number(value);
    if (value !== "" && !Number.isFinite(parsed)) return;
    setOccupancyShares((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index
          ? { ...item, sharePercent: value === "" ? 0 : parsed }
          : item,
      ),
    );
    setResult(null);
  }

  function addOccupancy() {
    if (occupancyShares.length >= dataset.occupancies.length) return;
    setOccupancyShares((current) => {
      if (!current.length) return [{ code: "", sharePercent: 100 }];
      const newShare = current[0].sharePercent / 2;
      return [
        { ...current[0], sharePercent: current[0].sharePercent - newShare },
        ...current.slice(1),
        { code: "", sharePercent: newShare },
      ];
    });
    setResult(null);
  }

  function removeOccupancy(index: number) {
    setOccupancyShares((current) => {
      const removedShare = current[index]?.sharePercent ?? 0;
      const next = current.filter((_item, currentIndex) => currentIndex !== index);
      if (next.length) {
        next[0] = {
          ...next[0],
          sharePercent:
            next[0].sharePercent + (next.length === 1 ? 100 - next[0].sharePercent : removedShare),
        };
      }
      return next;
    });
    setResult(null);
  }

  function updateDesignValue(id: string, value: string) {
    const parsed = Number(value);
    setDesignValues((current) => {
      const next = { ...current };
      if (value === "" || !Number.isFinite(parsed)) {
        delete next[id];
      } else {
        next[id] = parsed;
      }
      return next;
    });
    setResult(null);
  }

  function toggleIncentive(id: string) {
    setIncentiveIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setResult(null);
  }

  async function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setNotice("");
    setResult(null);

    const fail = (field: string, message: string) => {
      setFieldErrors({ [field]: message });
      setFormError(message);
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    };

    if (!blockId) {
      fail("block", "Select a DAP block for this assessment.");
      return;
    }
    if (!areaValue || !Number.isFinite(Number(areaValue)) || Number(areaValue) <= 0) {
      fail("plot-area", "Enter a plot area greater than zero.");
      return;
    }
    if (!existingRoadFt || Number(existingRoadFt) <= 0) {
      fail("existing-road-feet", "Enter the existing road width.");
      return;
    }
    if (proposedRoadRequired && proposedRoadWidthNumber <= 0) {
      fail("proposed-road-feet", "Enter the proposed road width required by the DAP.");
      return;
    }
    if (
      mandatoryWideningRequired &&
      !roadWideningNotPossible &&
      dataset.roadWidening &&
      proposedRoadWidthNumber < dataset.roadWidening.targetRoadWidthFt
    ) {
      fail(
        "proposed-road-feet",
        `This road must be widened to at least ${formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft.`,
      );
      return;
    }
    if (
      narrowRoadOutsideOldDhaka &&
      dataset.roadWidening &&
      proposedRoadWidthNumber < dataset.roadWidening.targetRoadWidthFt
    ) {
      fail(
        "proposed-road-feet",
        `Roads narrower than 2.5 m are only allowed for Old Dhaka blocks. Enter a proposed road width of at least ${formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft.`,
      );
      return;
    }
    if (
      proposedRoadWidthNumber > 0 &&
      proposedRoadWidthNumber < existingRoadWidthNumber
    ) {
      fail("proposed-road-feet", "The proposed road width cannot be narrower than the existing road.");
      return;
    }
    if (
      surrenderedLandRequired &&
      (surrenderedPreviewSqft === null || surrenderedPreviewSqft <= 0)
    ) {
      fail(
        "surrendered-area",
        "Enter the land area surrendered for road widening; floor area is based on the net plot.",
      );
      return;
    }
    if (
      areaUnit !== "sqft" &&
      areaUnit !== "sqm" &&
      !dataset.areaUnitSqft?.[areaUnit]
    ) {
      fail("plot-area", `The active dataset needs a square-foot conversion for ${areaUnit}.`);
      return;
    }
    if (
      surrenderedUnit !== "sqft" &&
      surrenderedUnit !== "sqm" &&
      Number(surrenderedValue) > 0 &&
      !dataset.areaUnitSqft?.[surrenderedUnit]
    ) {
      fail(
        "surrendered-area",
        `The active dataset needs a square-foot conversion for ${surrenderedUnit}.`,
      );
      return;
    }
    if (
      occupancyMode === "mixed" &&
      !dataset.mixedOccupancyCapMethod
    ) {
      fail(
        "occupancy",
        "Mixed occupancy is not enabled until its FAR cap method is present in the rule data.",
      );
      return;
    }
    if (
      dataset.plotAreaBasis === "net-after-surrender" &&
      Number(surrenderedValue || 0) > 0 &&
      surrenderedPreviewSqft === null
    ) {
      fail("surrendered-area", "Select an area unit supported by the active ruleset for surrendered land.");
      return;
    }
    if (
      occupancyShares.some((item) => !item.code) ||
      occupancyShares.some((item) => item.sharePercent <= 0) ||
      Math.abs(
        occupancyShares.reduce((total, item) => total + item.sharePercent, 0) -
          100,
      ) > 0.01
    ) {
      fail("occupancy", "Choose each occupancy and make the occupancy shares total 100%.");
      return;
    }

    setIsCalculating(true);
    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          plotArea: Number(areaValue),
          plotAreaUnit: areaUnit,
          existingRoadWidthFt: Number(existingRoadFt),
          proposedRoadWidthFt: proposedRoadFt ? Number(proposedRoadFt) : null,
          roadWideningNotPossible,
          surrenderedArea: Number(surrenderedValue || 0),
          surrenderedAreaUnit: surrenderedUnit,
          occupancyMode,
          occupancyShares,
          zoneOverride: zoneOverride || null,
          incentiveIds,
          manualFarEnabled,
          manualFar: manualFarEnabled && manualFar ? Number(manualFar) : null,
          plotFrontageFt: Number(frontageFt) > 0 ? Number(frontageFt) : null,
          designValues: Object.fromEntries(
            dataset.designInputs.flatMap((item) => {
              const value = designValues[item.id] ?? item.defaultValue;
              return value === undefined ? [] : [[item.id, value]];
            }),
          ),
          lockedInputs: hardLocks,
        }),
      });
      const body = (await response.json()) as
        | { result: CalculationResult }
        | ApiError;
      if (!response.ok || !("result" in body)) {
        throw new Error(resultErrorMessage(body as ApiError));
      }
      setResult(body.result);
      setResultTab("far");
      window.history.replaceState(null, "", `?${shareQuery()}`);
      window.setTimeout(
        () => {
          document.getElementById("results")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          });
          if (window.matchMedia("(max-width: 768px)").matches) {
            resultHeadingRef.current?.focus();
          }
        },
        60,
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The calculation service is unavailable.",
      );
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      setIsCalculating(false);
    }
  }

  function setRoadWidthFromMeters(
    value: string,
    setter: (next: string) => void,
  ) {
    const parsed = Number(value);
    setter(
      value === "" || !Number.isFinite(parsed)
        ? ""
        : formatNumber(parsed * feetPerMeter, 3),
    );
    setResult(null);
  }

  function printReport() {
    if (result) window.print();
  }

  function toggleHardLock(id: string) {
    setHardLocks((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setResult(null);
  }

  const blockType = (block: RuleDataset["blocks"][number]) =>
    block.typeCode?.toLowerCase() === "p"
      ? "planned"
      : block.typeCode?.toLowerCase() === "s"
        ? "spontaneous"
        : "other";

  const siteCoverageReportFields: CalculationResult["reportFields"]["groundCoverage"] =
    result?.siteCoverage
      ? [
          ...(result.siteCoverage.minGroundCoveragePercent === null
            ? []
            : [
                {
                  id: "site-coverage-minimum",
                  label: "Minimum ground coverage",
                  value: result.siteCoverage.minGroundCoveragePercent,
                  unit: "%",
                  precision: 2,
                },
              ]),
          {
            id: "site-coverage-maximum",
            label: "Maximum ground coverage",
            value: result.siteCoverage.maxGroundCoveragePercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-coverage-area",
            label: "Maximum ground coverage area",
            value: result.siteCoverage.groundCoverageSqft,
            unit: "sq ft",
            precision: 0,
          },
          {
            id: "site-coverage-exceptions",
            label: "Maximum coverage including exceptions",
            value: result.siteCoverage.maxGroundCoverageWithExceptionsPercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-open-space",
            label: "Mandatory open space",
            value: result.siteCoverage.mandatoryOpenSpacePercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-open-space-area",
            label: "Mandatory open space area",
            value: result.siteCoverage.mandatoryOpenSpaceSqft,
            unit: "sq ft",
            precision: 0,
          },
          {
            id: "site-rainwater",
            label: "Rainwater absorption requirement",
            value: result.siteCoverage.rainwaterAbsorptionPercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-rainwater-area",
            label: "Rainwater absorption area",
            value: result.siteCoverage.rainwaterAbsorptionSqft,
            unit: "sq ft",
            precision: 0,
          },
          {
            id: "site-basement",
            label: "Max basement footprint (max MGC + ½ open space)",
            value:
              result.siteCoverage.maxGroundCoveragePercent +
              result.siteCoverage.mandatoryOpenSpacePercent / 2,
            unit: "%",
            precision: 2,
          },
        ]
      : [];
  const resultRows = result
    ? resultSections[resultTab].map((section) => ({
        section,
        fields: [
          ...result.reportFields[section],
          ...(section === "groundCoverage" ? siteCoverageReportFields : []),
        ],
      }))
    : [];
  const mixedModeUnavailable =
    occupancyMode === "mixed" && !dataset.mixedOccupancyCapMethod;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="skip-link" href="#calculator">Skip to calculator</a>
        <Link className="brand" href="/" aria-label="Foundrio FAR Calculator home">
          <Image className="brand-mark" src="/brand/foundrio-mark.png" alt="" width={40} height={40} loading="eager" />
          <span>
            <strong>FOUNDRIO</strong>
            <small>FAR Calculator</small>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#calculator">Calculator</a>
          <a href="#results">Your result</a>
          <a href={`${foundrio.site}/services/`}>Services</a>
          <a href={`${foundrio.site}/projects/`}>Projects</a>
        </nav>
        <a className="button-call" href={foundrio.tel} aria-label={`Call Foundrio ${foundrio.phone}`}>
          <Phone size={16} aria-hidden="true" />
          <span>Call <span className="call-number">{foundrio.phone}</span></span>
        </a>
      </header>

      <main id="main">
      <section className="hero-strip">
        <div>
          <div className="eyebrow"><span /> Free tool by Foundrio · RAJUK DAP 2022–2035</div>
          <h1>How much can you <em>build</em> on your plot?</h1>
          <p>
            Enter your plot size, road width and building use. You get the allowed
            floor area, storeys, apartments and parking under Dhaka&apos;s DAP and
            Building Rules 2025.
          </p>
          <ul className="trust-line" aria-label="About Foundrio">
            <li><b>250+</b> projects delivered</li>
            <li><b>10+</b> years in practice</li>
            <li>Architecture · Structure · Interiors · MEP</li>
          </ul>
        </div>
        <div className="hero-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Estimate only, not RAJUK approval. Foundrio&apos;s architects can review it for your plot.</span>
        </div>
      </section>

      <form className="calculator-layout" id="calculator" onSubmit={calculate} noValidate>
        <div className="input-column">
          <div className="progress-card">
            <div className="progress-copy">
              <span className="progress-step">SITE INPUTS</span>
              <strong>Build your assessment</strong>
              <small>Five sections. Start with the three required site details.</small>
            </div>
            <div className="progress-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${result ? 1 : coreDetailsComplete / 3})` }} />
            </div>
            <span className={`progress-state ${result ? "done" : ""}`}>
                {result ? "Assessment ready" : `${coreDetailsComplete} of 3 core details`}
            </span>
          </div>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">01</span>
              <div><h2>Choose your location</h2><p>Select the DAP block for the plot.</p></div>
            </div>
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search blocks"
                placeholder="Search block or area"
                value={blockSearch}
                onChange={(event) => setBlockSearch(event.target.value)}
              />
              {blockSearch && (
                <button
                  aria-label="Clear block search"
                  onClick={() => setBlockSearch("")}
                  type="button"
                >×</button>
              )}
            </div>
            <div className="block-tools">
              <div className="filter-pills" role="group" aria-label="Block type filters">
                {([
                  ["all", "All"],
                  ["planned", "Planned"],
                  ["spontaneous", "Spontaneous"],
                ] as const).map(([id, label]) => (
                  <button
                    aria-pressed={blockFilter === id}
                    className={blockFilter === id ? "selected" : ""}
                    key={id}
                    onClick={() => setBlockFilter(id)}
                    type="button"
                  >{label}</button>
                ))}
              </div>
              <label className="compact-select">
                <span className="visually-hidden">Filter by zone</span>
                <select
                  aria-label="Filter by zone"
                  value={zoneFilter}
                  onChange={(event) => setZoneFilter(event.target.value)}
                >
                  <option value="all">All zones</option>
                  {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
            <div className="block-list" id="block">
              {filteredBlocks.length ? filteredBlocks.map((block) => (
                <button
                  aria-pressed={blockId === block.id}
                  className={`block-option ${blockId === block.id ? "active" : ""}`}
                  disabled={block.buildable === false || block.areaFar <= 0}
                  key={block.id}
                  onClick={() => {
                    setBlockId(block.id);
                    setZoneOverride("");
                    setRoadWideningNotPossible(false);
                    setResult(null);
                  }}
                  type="button"
                >
                  <span className="block-copy">
                    <span className="block-title">
                      <strong>{block.id}</strong>
                      <span>{block.label}</span>
                      {block.typeCode && (
                        <i className={`type-tag type-${blockType(block)}`}>
                          {block.typeCode}
                        </i>
                      )}
                    </span>
                    <small>
                      {block.buildable === false
                        ? "Reserved / restricted — no development FAR"
                        : [block.englishName, block.zone].filter(Boolean).join(" · ") || "DAP block"}
                    </small>
                  </span>
                  <span className="block-value">
                    <small>Area FAR</small>
                    <b>{formatNumber(block.areaFar)}</b>
                    {block.densityPerAcre !== undefined && (
                      <small>{formatNumber(block.densityPerAcre, 0)} / acre</small>
                    )}
                  </span>
                  {blockId === block.id && <Check className="block-selected" size={17} />}
                </button>
              )) : (
                <div className="empty-list">
                  {dataset.blocks.length
                    ? "No blocks match those filters."
                    : "No DAP blocks are loaded yet."}
                </div>
              )}
            </div>
            {dataset.blocks.length > 0 && (
              <small className="list-hint">
                {filteredBlocks.length} of {dataset.blocks.length} blocks. Scroll the list or search by name, ward or area.
              </small>
            )}
            <details className="map-details" open={showMap} onToggle={(event) => setShowMap(event.currentTarget.open)}>
              <summary><MapPin size={15} /> Pick from map <ChevronDown size={14} /></summary>
              <div className="map-wrap">
                {showMap && (
                  <LocationMap
                    dataset={dataset}
                    selectedBlockId={blockId}
                    point={point}
                    onSelectBlock={(id) => {
                      setBlockId(id);
                      setZoneOverride("");
                      setRoadWideningNotPossible(false);
                      setResult(null);
                    }}
                    onSelectPoint={setPoint}
                  />
                )}
              </div>
              {point && (
                <p className="coordinate-row">
                  Selected point: {point[0].toFixed(5)}, {point[1].toFixed(5)}
                  <button onClick={() => setPoint(null)} type="button">Clear</button>
                </p>
              )}
              {point && (() => {
                const nearest = nearestMrtStation(point[0], point[1]);
                return (
                  <p className="field-hint">
                    Nearest MRT-6 station: {nearest.station.name}{"opens" in nearest.station ? ` (opens ${nearest.station.opens})` : ""}, about {formatNumber(nearest.meters, 0)} m away.
                    The TOD incentive is set by the TOD Guideline 2025 (DAP Table 3.28 row 6); enter only an approved amount.
                  </p>
                );
              })()}
              <p className="field-hint">
                Click a block marker to select it. Markers are approximate block centres, not boundaries; confirm the block on the RAJUK masterplan.
              </p>
            </details>
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">02</span>
              <div><h2>Plot &amp; road dimensions</h2><p>Enter measured dimensions and any proposed road widening.</p></div>
            </div>
            <div className="land-area-header">
              <label htmlFor="plot-area">Plot land area</label>
              <span>
                {areaPreviewSqft === null
                  ? areaUnit !== "sqft" && areaValue
                    ? "Conversion needed in rules"
                    : "Enter plot size"
                  : `≈ ${formatNumber(areaPreviewSqft, 0)} sq ft`}
              </span>
            </div>
            <div className="area-control">
              <input
                id="plot-area"
                aria-describedby={fieldErrors["plot-area"] ? "error-plot-area" : undefined}
                aria-invalid={Boolean(fieldErrors["plot-area"])}
                inputMode="decimal"
                min="0"
                placeholder="e.g. 5"
                type="number"
                value={areaValue}
                onChange={(event) => {
                  setAreaValue(event.target.value);
                  setResult(null);
                }}
              />
              <label className="area-unit-select">
                <span className="visually-hidden">Plot area unit</span>
                <select
                  aria-label="Plot area unit"
                  value={areaUnit}
                  onChange={(event) => {
                    setAreaUnit(event.target.value as typeof areaUnit);
                    setResult(null);
                  }}
                >
                  {areaUnits.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
            <div className="dimension-grid">
              <RoadWidthField
                id="existing-road"
                label="Widest adjoining road width"
                invalid={Boolean(fieldErrors["existing-road-feet"])}
                valueFt={existingRoadFt}
                onFeetChange={(value) => {
                  setExistingRoadFt(value);
                  setRoadWideningNotPossible(false);
                  setResult(null);
                }}
                onMetersChange={(value) =>
                  setRoadWidthFromMeters(value, (next) => {
                    setExistingRoadFt(next);
                    setRoadWideningNotPossible(false);
                  })
                }
              />
              <RoadWidthField
                id="proposed-road"
                label="DAP proposed road width"
                invalid={Boolean(fieldErrors["proposed-road-feet"])}
                valueFt={proposedRoadFt}
                onFeetChange={(value) => { setProposedRoadFt(value); setResult(null); }}
                onMetersChange={(value) => setRoadWidthFromMeters(value, setProposedRoadFt)}
                optional={!proposedRoadRequired}
              />
              <RoadWidthField
                id="plot-frontage"
                label="Plot road frontage (for setbacks)"
                valueFt={frontageFt}
                onFeetChange={(value) => { setFrontageFt(value); setResult(null); }}
                onMetersChange={(value) => setRoadWidthFromMeters(value, setFrontageFt)}
                optional
              />
            </div>
            <p className="field-hint">
              If the plot adjoins multiple roads, use the widest one for FAR (Rule 47(10)).
            </p>
            {mandatoryWideningRequired && dataset.roadWidening && (
              <>
                <p className="field-hint">
                  DAP Rule 47 requires this road to widen to at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft. Enter the proposed width and the land surrendered for widening, or use the exception below if widening is impossible.
                </p>
                <label className="toggle-line road-exception-toggle">
                  <input
                    checked={roadWideningNotPossible}
                    onChange={(event) => {
                      const notPossible = event.target.checked;
                      setRoadWideningNotPossible(notPossible);
                      if (notPossible) {
                        setProposedRoadFt("");
                        setSurrenderedValue("0");
                      }
                      setResult(null);
                    }}
                    type="checkbox"
                  />
                  <span className="custom-check"><Check size={12} /></span>
                  <span><strong>Widening is impossible under the Rule 47(7) exception</strong><small>Use the existing road width for FAR. Confirm the exception applies to this road.</small></span>
                </label>
              </>
            )}
            {narrowRoadOutsideOldDhaka && dataset.roadWidening && (
              <p className="field-hint">
                DAP Rule 47 allows roads narrower than 2.5 m only in Old Dhaka. Enter a proposed width of at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft and the surrendered land area.
              </p>
            )}
            <div className="surrender-row">
              <div>
                <label htmlFor="surrendered-area">Land surrendered for road widening</label>
                <small>Only applies when the active ruleset supports it.</small>
              </div>
              <div className="surrender-control">
                <input
                  id="surrendered-area"
                  aria-describedby={fieldErrors["surrendered-area"] ? "error-surrendered-area" : undefined}
                  aria-invalid={Boolean(fieldErrors["surrendered-area"])}
                  min="0"
                  type="number"
                  value={surrenderedValue}
                  onChange={(event) => {
                    setSurrenderedValue(event.target.value);
                    setResult(null);
                  }}
                />
                <select
                  aria-label="Surrendered area unit"
                  value={surrenderedUnit}
                  onChange={(event) => setSurrenderedUnit(event.target.value as typeof surrenderedUnit)}
                >
                  {areaUnits.map((unit) => (
                    <option key={unit.value} value={unit.value}>{areaLabel[unit.value]}</option>
                  ))}
                </select>
              </div>
              {surrenderedPreviewSqft !== null && (
                <small className="surrender-equivalent">{formatNumber(surrenderedPreviewSqft, 0)} sq ft</small>
              )}
            </div>
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">03</span>
              <div><h2>Building occupancy</h2><p>Choose building use and planning-zone treatment.</p></div>
              <Building2 className="heading-icon" size={19} />
            </div>
            <div className="mode-toggle" role="group" aria-label="Occupancy mode">
              <button
                aria-pressed={occupancyMode === "single"}
                className={occupancyMode === "single" ? "selected" : ""}
                onClick={() => changeOccupancyMode("single")}
                type="button"
              >Single occupancy</button>
              <button
                aria-pressed={occupancyMode === "mixed"}
                className={occupancyMode === "mixed" ? "selected" : ""}
                onClick={() => changeOccupancyMode("mixed")}
                type="button"
              >Mixed occupancy</button>
            </div>
            {mixedModeUnavailable && (
              <p className="inline-notice">
                Mixed occupancy will be available when its cap rule is included in the dataset.
              </p>
            )}
            {occupancyMode === "single" ? (
              <div className="field">
                <label htmlFor="occupancy">Building purpose / occupancy type</label>
                <Select
                  id="occupancy"
                  value={occupancyShares[0]?.code ?? ""}
                  disabled={!dataset.occupancies.length}
                  onChange={setOccupancySelection}
                  placeholder={dataset.occupancies.length ? "Choose an occupancy" : "Occupancy data not loaded"}
                  options={dataset.occupancies.map((occupancy) => ({
                    value: occupancy.code,
                    label: `${occupancy.code} - ${occupancy.label}`,
                  }))}
                />
                {occupancyShares[0] && (
                  <div className="occupancy-summary">
                    <span className="code-pill">{occupancyShares[0].code}</span>
                    <strong>
                      {dataset.occupancies.find((item) => item.code === occupancyShares[0].code)?.label}
                    </strong>
                    <span className="occupancy-group">
                      {dataset.occupancies.find((item) => item.code === occupancyShares[0].code)?.group ?? "Building use"}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mixed-fields">
                {occupancyShares.map((share, index) => (
                  <div className="mixed-line" key={`occupancy-${index}`}>
                    <div className="field">
                      <label htmlFor={`mixed-occupancy-${index}`}>
                        {index === 0 ? "Primary use" : `Additional use ${index}`}
                      </label>
                      <Select
                        id={`mixed-occupancy-${index}`}
                        value={share.code}
                        onChange={(code) => updateOccupancy(index, code)}
                        options={dataset.occupancies
                          .filter((item) =>
                            !occupancyCodes.includes(item.code) ||
                            item.code === share.code,
                          )
                          .map((item) => ({
                            value: item.code,
                            label: `${item.code} - ${item.label}`,
                          }))}
                      />
                    </div>
                    <div className="share-field">
                      <label htmlFor={`occupancy-share-${index}`}>Share</label>
                      <div className="input-with-unit">
                        <input
                          id={`occupancy-share-${index}`}
                          max="100"
                          min="0.01"
                          step="0.01"
                          onChange={(event) =>
                            changeOccupancyShare(index, event.target.value)
                          }
                          type="number"
                          value={share.sharePercent}
                        />
                        <span>%</span>
                      </div>
                    </div>
                    {occupancyShares.length > 2 && (
                      <button
                        aria-label={`Remove occupancy ${index + 1}`}
                        className="remove-occupancy"
                        onClick={() => removeOccupancy(index)}
                        type="button"
                      >×</button>
                    )}
                  </div>
                ))}
                {occupancyShares.length < dataset.occupancies.length && (
                  <button className="add-occupancy" onClick={addOccupancy} type="button">
                    + Add another building use
                  </button>
                )}
              </div>
            )}
            {dataset.calculationMode !== "dap-2025" && (
              <div className="zone-override">
                <div className="zone-heading">
                  <div><Layers3 size={15} /><strong>DAP planning zone</strong></div>
                  <span>{zoneOverride || `Auto${selectedBlock?.zone ? `: ${selectedBlock.zone}` : ""}`}</span>
                </div>
                <label className="field-label" htmlFor="zone-override">Override zone (optional)</label>
                <Select
                  id="zone-override"
                  value={zoneOverride}
                  onChange={(value) => { setZoneOverride(value); setResult(null); }}
                  placeholder="Auto (from selected block)"
                  options={Array.from(new Set([
                    ...zones,
                    ...Object.keys(selectedBlock?.areaFarByZone ?? {}),
                  ])).map((zone) => ({ value: zone, label: zone }))}
                />
                {zoneOverride &&
                  selectedBlock?.areaFarByZone?.[zoneOverride] === undefined && (
                  <small className="field-hint">The selected block must include an Area FAR for this override.</small>
                )}
              </div>
            )}
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">04</span>
              <div><h2>FAR incentives</h2><p>Automatic provisions and eligible project choices from your dataset.</p></div>
              <BadgeCheck className="heading-icon" size={19} />
            </div>
            {automaticIncentives.length > 0 && (
              <div className="auto-incentives">
                <div className="auto-heading">
                  <strong>Calculated from your plot</strong>
                  <span>Automatic</span>
                </div>
                {automaticIncentives.map((item) => (
                  <div className="auto-incentive" key={item.id}>
                    <div><strong>{item.label}</strong><small>{item.group ?? "Auto from plot and road details"}</small></div>
                    <span>{item.calculation?.mode === "road-width" ? "Road width" : item.calculation?.mode === "plot-area-tier" ? "Plot size" : item.calculation?.mode === "distance-tier" ? "Distance" : "Auto"}</span>
                  </div>
                ))}
              </div>
            )}
            {selectableIncentives.length > 0 ? (
              <div className="incentive-choices">
                {selectableIncentives.map((item) => (
                  <label className="incentive-choice" key={item.id}>
                    <input
                      checked={incentiveIds.includes(item.id)}
                      onChange={() => toggleIncentive(item.id)}
                      type="checkbox"
                    />
                    <span className="custom-check"><Check size={12} /></span>
                    <span className="incentive-copy">
                      <strong>{item.label}</strong>
                      {item.group && <small>{item.group}</small>}
                    </span>
                    <span className="bonus-tag">
                      {item.calculation?.mode === "input"
                        ? "Enter FAR"
                        : item.farBonus !== undefined
                          ? `+${formatNumber(item.farBonus)}`
                          : "Rule-based"}
                    </span>
                  </label>
                ))}
              </div>
            ) : automaticIncentives.length === 0 ? (
              <div className="empty-incentives">No incentive rules have been added to the active dataset.</div>
            ) : null}
            {incentiveInputs.length > 0 && (
              <div className="inline-inputs">
                {incentiveInputs.map((item) => (
                  <DesignInput
                    key={item.id}
                    item={item}
                    value={designValues[item.id]}
                    locked={hardLocks.includes(item.id)}
                    onValueChange={(value) => updateDesignValue(item.id, value)}
                    onLockChange={() => toggleHardLock(item.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <details className="panel input-panel optional-step">
            <summary className="step-heading">
              <span className="step-number" aria-hidden="true">05</span>
              <h2>Building &amp; parking inputs <span className="optional-tag">Optional</span></h2>
              <ChevronDown className="heading-icon" size={19} aria-hidden="true" />
            </summary>
            <p className="step-intro">Fine-tune storey height, units and parking.</p>
            {(layoutInputs.length > 0 || parkingInputs.length > 0) ? (
              <>
                {layoutInputs.length > 0 && (
                  <div className="design-input-grid">
                    {layoutInputs.map((item) => (
                      <DesignInput
                        key={item.id}
                        item={item}
                        value={designValues[item.id]}
                        locked={hardLocks.includes(item.id)}
                        onValueChange={(value) => updateDesignValue(item.id, value)}
                        onLockChange={() => toggleHardLock(item.id)}
                      />
                    ))}
                  </div>
                )}
                {parkingInputs.length > 0 && (
                  <div className="design-input-grid">
                    {parkingInputs.map((item) => (
                      <DesignInput
                        key={item.id}
                        item={item}
                        value={designValues[item.id]}
                        locked={hardLocks.includes(item.id)}
                        onValueChange={(value) => updateDesignValue(item.id, value)}
                        onLockChange={() => toggleHardLock(item.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="not-configured">
                Layout, unit mix, basement, and parking fields will appear here when included in the dataset.
              </div>
            )}
            <div className="manual-override">
              <label className="toggle-line">
                <input
                  checked={manualFarEnabled}
                  onChange={(event) => {
                    setManualFarEnabled(event.target.checked);
                    setResult(null);
                  }}
                  type="checkbox"
                />
                <span className="custom-check"><Check size={12} /></span>
                <span><strong>Use manual FAR override</strong><small>Limited to the computed FAR, including applicable incentives and DAP exceptions.</small></span>
              </label>
              {manualFarEnabled && (
                <div className="manual-far-field">
                  <label htmlFor="manual-far">Manual FAR</label>
                  <input
                    id="manual-far"
                    min="0"
                    step="0.01"
                    onChange={(event) => { setManualFar(event.target.value); setResult(null); }}
                    placeholder="Enter FAR"
                    type="number"
                    value={manualFar}
                  />
                  <small>{selectedBlock ? "The applied FAR is checked against the selected DAP and occupancy rules." : "Select a block and occupancy first."}</small>
                </div>
              )}
            </div>
          </details>

          {(formError || notice || loadError) && (
            <div
              ref={errorSummaryRef}
              className={`alert ${formError || loadError ? "alert-error" : "alert-success"}`}
              role={formError || loadError ? "alert" : "status"}
              tabIndex={formError || loadError ? -1 : undefined}
            >
              {Object.entries(fieldErrors).length > 0 && (
                <ul className="error-summary">
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${field}`}>{message}</a>
                      <span className="visually-hidden" id={`error-${field}`}>{message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {formError || loadError || notice}
            </div>
          )}
          <button
            className="button-primary calculate-button"
            disabled={isCalculating || isLoadingRules}
            type="submit"
          >
            {isCalculating ? "Calculating..." : "Calculate my plot"}
            <ArrowRight size={17} />
          </button>
          {!hasCalculationData && (
            <p className="calculate-hint">
              {isLoadingRules ? "Loading the building rules..." : "The building rules could not be loaded. Please refresh the page."}
            </p>
          )}

        </div>

        <aside className="result-column" id="results">
          <p className="visually-hidden" role="status">
            {result ? `You can build about ${formatNumber(result.floorAreaSqft, 0)} square feet. ${resultSummary(result)}` : ""}
          </p>
          <section className={`result-card ${result ? "has-result" : ""}`} aria-labelledby="results-heading">
            <div className="result-topline">
              <span><BadgeCheck size={15} aria-hidden="true" /> Your plot</span>
              <span className="result-chip">{result ? result.blockLabel : "Ready when you are"}</span>
            </div>
            {/* Keyed so each new result remounts and replays the reveal. */}
            <div key={result ? `${result.blockLabel}-${result.appliedFar}-${result.floorAreaSqft}` : "empty"} className={result ? "reveal" : undefined}>
            <h2 ref={resultHeadingRef} id="results-heading" tabIndex={-1}>
              {result
                ? <>You can build about <span className="nowrap">{formatNumber(result.floorAreaSqft, 0)} sq ft</span></>
                : "Your plot's building potential appears here."}
            </h2>
            <p className="result-description">
              {result
                ? resultSummary(result)
                : "Fill in the three required details, then tap Calculate."}
            </p>
            <div className="far-display">
              <span>{result && result.manualFar !== null ? "Your FAR (manual entry)" : "Allowed FAR (floor area ratio)"}</span>
              <strong>{result ? formatNumber(result.appliedFar) : "--"}</strong>
              <small>
                {!result
                  ? "Based on the active ruleset"
                  : result.manualFar !== null
                    ? `Rules calculate ${formatNumber(result.calculatedFar)}`
                    : "Floor area = plot area × FAR"}
              </small>
            </div>
            <div className="result-lines">
              <div><span>Area FAR</span><b>{result ? formatNumber(result.areaFar) : "--"}</b></div>
              <div><span>Plot FAR</span><b>{result ? formatNumber(result.roadFar) : "--"}</b></div>
              <div><span>Base FAR</span><b>{result ? formatNumber(result.baseFar) : "--"}</b></div>
              <div><span>Total bonus</span><b>{result ? `+${formatNumber(result.totalBonusFar)}` : "--"}</b></div>
            </div>
            <div className="floor-area-box">
              <span>Total FAR-included area</span>
              <strong>{result ? `${formatNumber(result.floorAreaSqft, 0)} sq ft` : "--"}</strong>
              {result && result.netPlotAreaSqft !== result.plotAreaSqft && (
                <small>Net plot area: {formatNumber(result.netPlotAreaSqft, 0)} sq ft</small>
              )}
            </div>
            {result?.buildingSummary && (
              <div className="result-lines" aria-label="Simple building result">
                <div><span>Building</span><b>G+{result.buildingSummary.upperFloors} ({result.buildingSummary.storeys} storeys)</b></div>
                <div><span>Apartments / floor</span><b>{result.buildingSummary.unitsPerFloor}</b></div>
                <div><span>Apartment size</span><b>{formatNumber(result.buildingSummary.unitSizeSqft, 0)} sq ft</b></div>
                <div><span>Total apartments</span><b>{result.buildingSummary.totalUnits}</b></div>
                <div><span>Car parking</span><b>{result.buildingSummary.carsRequired}{result.buildingSummary.bikesRequired > 0 ? ` + ${result.buildingSummary.bikesRequired} bikes` : ""}</b></div>
              </div>
            )}
            </div>
            {result && (
              <>
                <button className="button-report" onClick={printReport} type="button">
                  <Printer size={15} /> Print / Save as PDF
                </button>
                <button className="button-report" onClick={downloadCsv} type="button">
                  <Download size={15} /> Download report (CSV)
                </button>
                <button className="button-report" onClick={shareResult} type="button">
                  <Share2 size={15} aria-hidden="true" /> Share result
                </button>
                <div className="result-disclaimer"><CircleHelp size={14} /><span>Informational estimate only. Confirm all constraints with RAJUK.</span></div>
              </>
            )}
          </section>

          <FoundrioCard key={result ? "result" : "empty"} result={result} />

          {result && (
            <section className="panel detail-results">
              <div className="results-heading">
                <div><span>DETAILED OUTPUT</span><h2>Project summary</h2></div>
                <span className="result-dataset">{dataset.name}</span>
              </div>
              <div className="result-tabs" role="tablist" aria-label="Assessment result sections">
                {([
                  ["far", "FAR & site"],
                  ["design", "Building"],
                  ["parking", "Parking & safety"],
                ] as const).map(([id, label]) => (
                  <button
                    id={`result-tab-${id}`}
                    aria-selected={resultTab === id}
                    tabIndex={resultTab === id ? 0 : -1}
                    className={resultTab === id ? "selected" : ""}
                    key={id}
                    onClick={() => setResultTab(id)}
                    onKeyDown={(event) => {
                      const tabs: ResultTab[] = ["far", "design", "parking"];
                      const index = tabs.indexOf(id);
                      const nextIndex =
                        event.key === "ArrowRight" ? (index + 1) % tabs.length :
                        event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
                        event.key === "Home" ? 0 :
                        event.key === "End" ? tabs.length - 1 : -1;
                      if (nextIndex >= 0) {
                        event.preventDefault();
                        setResultTab(tabs[nextIndex]);
                        document.getElementById(`result-tab-${tabs[nextIndex]}`)?.focus();
                      }
                    }}
                    role="tab"
                    type="button"
                  >{label}</button>
                ))}
              </div>
              {resultTab === "far" && (
                <div className="core-result-grid" id="result-panel-far" role="tabpanel" aria-labelledby="result-tab-far">
                  <Metric label="Base FAR" value={formatNumber(result.baseFar)} />
                  <Metric
                    label="Maximum FAR cap"
                    value={result.maxFarCap === null
                      ? result.uncappedFarEligible
                        ? "Table 5 uncapped option eligible"
                        : "Not defined"
                      : formatNumber(result.maxFarCap)}
                  />
                  <Metric label="DAP Area FAR" value={formatNumber(result.areaFar)} />
                  <Metric label="Road FAR" value={formatNumber(result.roadFar)} />
                  <Metric label="Existing road FAR" value={formatNumber(result.existingRoadFar)} />
                  <Metric label="Proposed road FAR" value={result.proposedRoadFar === null ? "Not entered" : formatNumber(result.proposedRoadFar)} />
                  {result.roadWideningExceptionUsed && (
                    <Metric label="Road widening" value="Rule 47(7) exception applied; confirmation required" />
                  )}
                  <Metric label="Plot area" value={`${formatNumber(result.plotAreaSqft, 0)} sq ft`} />
                  <Metric label="Surrendered land" value={`${formatNumber(result.surrenderedAreaSqft, 0)} sq ft`} />
                  <Metric label="Maximum floor area" value={`${formatNumber(result.floorAreaSqft, 0)} sq ft`} />
                  {result.uncappedFarEligible && (
                    <Metric label="Table 5 condition" value="Uncapped FAR option eligible; manual FAR still requires authority confirmation" />
                  )}
                  {result.maxFarCap !== null && result.appliedFar > result.maxFarCap && (
                    <Metric label="Rule 47(3) exception" value={`Applied ${formatNumber(result.appliedFar - result.maxFarCap)} FAR above the ordinary maximum`} />
                  )}
                  {result.manualFar !== null && <Metric label="Manual override" value={formatNumber(result.manualFar)} />}
                  {result.automaticBonuses.map((item) => <Metric key={item.label} label={item.label} value={`+${formatNumber(item.farBonus)}`} />)}
                  {result.selectedBonuses.map((item) => <Metric key={item.label} label={item.label} value={`+${formatNumber(item.farBonus)}`} />)}
                </div>
              )}
              {resultTab === "design" && result.buildingSummary && result.siteCoverage && (
                <LayoutEngine
                  key={`${result.floorAreaSqft}-${result.netPlotAreaSqft}`}
                  farAreaSqft={result.floorAreaSqft}
                  plotAreaSqft={result.netPlotAreaSqft}
                  minMgcPercent={result.siteCoverage.minGroundCoveragePercent}
                  maxMgcPercent={result.siteCoverage.maxGroundCoveragePercent}
                  unitsPerKatha={designValues.unitsPerKatha ?? selectedBlock?.unitsPerKatha ?? 2}
                  roadWidthFt={Math.max(result.existingRoadWidthFt, result.proposedRoadWidthFt ?? 0)}
                  targetUnitSqft={designValues.targetUnitSizeSqft}
                  referenceUnitSqft={selectedBlock?.avgUnitSizeSqft}
                  initialFrontLengthFt={Number(frontageFt) > 0 ? Number(frontageFt) : undefined}
                />
              )}
              {resultRows.map(({ section, fields }) => (
                <ReportSectionCard
                  key={section}
                  label={resultSectionLabels[section]}
                  fields={fields}
                  isConfigured={fields.length > 0}
                />
              ))}
              {resultTab !== "far" && resultRows.every((row) => row.fields.length === 0) && (
                <div className="not-configured result-empty">
                  {resultTab === "design"
                    ? "Building layout rules are not included yet. Add floor, unit, circulation, and size formulas to the dataset."
                    : "Parking, basement, stair, and lift rules are not included yet. Add the source values to the dataset."}
                </div>
              )}
              <details className="rule-details">
                <summary><span>How the rules are applied</span><ChevronDown size={15} aria-hidden="true" /></summary>
                <div className="source-list rule-notes">
                  <span>
                    {dataset.calculationMode === "dap-2025"
                      ? selectedUsesAreAllNonResidential
                        ? "DAP Rule 47(4): FAR for 100% non-residential use is determined from the occupancy-specific Road FAR schedule."
                        : "DAP Rule 47: Base FAR is the lower of Area FAR and Road FAR; Maximum FAR is the higher. Incentives raise the base up to that maximum. A gap of 0.1 or less is applied without incentives."
                      : "Base FAR, incentives, and any cap follow the active dataset."}
                    {result.surrenderedAreaSqft > 0
                      ? " DAP Article 3.6.4.2 converts three times the surrendered land area to additional floor area using the applied FAR."
                      : ""}
                    {result.maxFarCap !== null && result.appliedFar > result.maxFarCap
                      ? " Rule 47(3) exceptional FAR above the ordinary maximum is included for an eligible project."
                      : ""}
                    {result.zone ? ` Zone: ${result.zone}.` : ""}
                  </span>
                  {dataset.notes.map((note) => <span key={note}>{note}</span>)}
                </div>
              </details>
              <details className="rule-details">
                <summary><span>Rule references</span><ChevronDown size={15} aria-hidden="true" /></summary>
                <div className="source-list">
                  {result.sources.length
                    ? result.sources.map((source) => <span key={source}>{source}</span>)
                    : <span>No source reference was supplied with this ruleset.</span>}
                </div>
              </details>
            </section>
          )}

        </aside>
      </form>

      <div className="mobile-action-bar">
        <div>
          <strong>{result ? `${formatNumber(result.floorAreaSqft, 0)} sq ft buildable` : `${coreDetailsComplete} of 3 core details`}</strong>
          {result && <span>FAR {formatNumber(result.appliedFar)}{result.buildingSummary ? ` · G+${result.buildingSummary.upperFloors}` : ""}</span>}
        </div>
        {result ? (
          <span className="mobile-actions">
            <a className="button-icon" href={foundrio.tel} aria-label={`Call Foundrio ${foundrio.phone}`}>
              <Phone size={18} aria-hidden="true" />
            </a>
            <a className="button-primary" href="#results">See result</a>
          </span>
        ) : (
          <button className="button-primary" disabled={isCalculating || isLoadingRules} form="calculator" type="submit">
            {isCalculating ? "Calculating..." : "Calculate"}
          </button>
        )}
      </div>

      </main>

      {result && (
        <section className="print-report" aria-hidden="true">
          <div className="print-brand">
            <Image src="/brand/foundrio-mark.png" alt="" width={28} height={28} />
            Foundrio Design &amp; Consultant · FAR Calculator
          </div>
          <h1>Plot building potential: {result.blockLabel}</h1>
          <p>Prepared {new Date().toLocaleString()} with the Foundrio FAR Calculator · Estimate, not an approval</p>
          <p className="print-summary">
            You can build about {formatNumber(result.floorAreaSqft, 0)} sq ft. {resultSummary(result)}
          </p>
          <table>
            <tbody>
              <tr><th>DAP block</th><td>{result.blockLabel}</td></tr>
              <tr><th>Planning zone</th><td>{result.zone ?? "Automatic"}</td></tr>
              <tr><th>Building occupancy</th><td>{result.occupancyLabels.join(", ")}</td></tr>
              <tr><th>Plot area</th><td>{formatNumber(result.plotAreaSqft, 0)} sq ft</td></tr>
              <tr><th>Area FAR</th><td>{formatNumber(result.areaFar)}</td></tr>
              <tr><th>Existing / proposed road FAR</th><td>{formatNumber(result.existingRoadFar)} / {result.proposedRoadFar === null ? "Not entered" : formatNumber(result.proposedRoadFar)}</td></tr>
              {result.roadWideningExceptionUsed && <tr><th>Road widening</th><td>Rule 47(7) exception applied; confirmation required</td></tr>}
              <tr><th>Base FAR</th><td>{formatNumber(result.baseFar)}</td></tr>
              <tr><th>Bonus FAR</th><td>{formatNumber(result.totalBonusFar)}</td></tr>
              <tr><th>Calculated / applied FAR</th><td>{formatNumber(result.calculatedFar)} / {formatNumber(result.appliedFar)}</td></tr>
              <tr><th>Total FAR-included floor area</th><td>{formatNumber(result.floorAreaSqft, 0)} sq ft</td></tr>
            </tbody>
          </table>
          {Object.entries(result.reportFields).map(([section, fields]) => fields.length ? (
            <section key={section}>
              <h2>{resultSectionLabels[section as ReportSection]}</h2>
              <table><tbody>{fields.map((field) => (
                <tr key={field.id}><th>{field.label}</th><td>{amountWithUnit(field.value, field.unit, field.precision)}</td></tr>
              ))}</tbody></table>
            </section>
          ) : null)}
          <h2>Rule references</h2>
          <ul>{result.sources.map((source) => <li key={source}>{source}</li>)}</ul>
          <p className="print-disclaimer">
            This assessment uses the active user-provided ruleset. It is not an official RAJUK
            determination, permit, or guarantee of approval. Verify source rules and project
            constraints with the relevant authorities.
          </p>
          <p className="print-contact">
            Next step: have this checked and designed by {foundrio.name}. Call {foundrio.phone} ·
            {" "}{foundrio.email} · foundrio-bd.com · {foundrio.address}
          </p>
        </section>
      )}

      <footer className="footer">
        <div className="footer-brand">
          <Image src="/brand/foundrio-mark.png" alt="" width={40} height={40} />
          <div>
            <strong>{foundrio.name}</strong>
            <span>Architecture, structure, interiors, MEP and construction. 250+ projects, 10+ years.</span>
          </div>
        </div>
        <ul className="footer-contact">
          <li><a href={foundrio.tel}><Phone size={15} aria-hidden="true" /> {foundrio.phone}</a></li>
          <li><a href={`mailto:${foundrio.email}`}><Mail size={15} aria-hidden="true" /> {foundrio.email}</a></li>
          <li><MapPin size={15} aria-hidden="true" /> {foundrio.address}</li>
        </ul>
        <nav className="footer-links" aria-label="Foundrio">
          <a href={foundrio.site}>foundrio-bd.com</a>
          <a href={`${foundrio.site}/services/`}>Services</a>
          <a href={`${foundrio.site}/projects/`}>Projects</a>
          <a href={`${foundrio.site}/contact/`}>Contact</a>
          <a href={foundrio.facebook}>Facebook</a>
        </nav>
        <p className="footer-note">
          <ShieldCheck size={14} aria-hidden="true" />
          Estimates follow DAP 2022–2035 and the Dhaka Building Construction Rules 2025.
          They are not RAJUK approval, a permit or legal advice.
        </p>
      </footer>
    </div>
  );
}

function FoundrioCard({ result }: { result: CalculationResult | null }) {
  const mail = result
    ? `mailto:${foundrio.email}?subject=${encodeURIComponent(`FAR enquiry: ${result.blockLabel}`)}&body=${encodeURIComponent(
        `Hello Foundrio,\n\nPlease contact me about this plot.\n\nPlot: ${formatNumber(result.plotAreaSqft / 720, 1)} katha, ${result.blockLabel}\n${result.manualFar !== null ? "FAR (manual entry)" : "Allowed FAR"}: ${formatNumber(result.appliedFar)}\nFloor area: ${formatNumber(result.floorAreaSqft, 0)} sq ft\nPlot link: ${window.location.href}\n\nName:\nPhone:`,
      )}`
    : `mailto:${foundrio.email}?subject=${encodeURIComponent("Plot consultation")}`;
  return (
    <section className={`promo-card${result ? " reveal reveal-late" : ""}`} aria-labelledby="promo-title">
      <Image className="promo-mark" src="/brand/foundrio-mark.png" alt="" width={36} height={36} />
      <h2 id="promo-title">
        {result ? <>Turn this estimate into a <em>real design</em></> : <>Planning a building in <em>Dhaka?</em></>}
      </h2>
      <p>
        {result
          ? "Foundrio's architects can check this result against your site, then design the most efficient building the rules allow: layout, structure, MEP and fire safety."
          : "Foundrio Design & Consultant has delivered 250+ projects in 10+ years, from architecture and structural design to interiors, MEP and construction."}
      </p>
      <div className="promo-actions">
        <a className="button-primary" href={foundrio.tel}><Phone size={16} aria-hidden="true" /> Call {foundrio.phone}</a>
        <a className="button-secondary" href={mail}><Mail size={16} aria-hidden="true" /> {result ? "Email this result" : "Email us"}</a>
      </div>
      <a className="promo-link" href={`${foundrio.site}${result ? "/contact/" : "/projects/"}`}>
        {result ? "Book a consultation" : "See our projects"} <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="select-shell">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={15} />
    </div>
  );
}

function RoadWidthField({
  id,
  label,
  valueFt,
  onFeetChange,
  onMetersChange,
  optional = false,
  invalid = false,
}: {
  id: string;
  label: string;
  valueFt: string;
  onFeetChange: (value: string) => void;
  onMetersChange: (value: string) => void;
  optional?: boolean;
  invalid?: boolean;
}) {
  const meters = valueFt && Number.isFinite(Number(valueFt))
    ? formatNumber(Number(valueFt) / feetPerMeter, 2)
    : "";
  return (
    <fieldset className="road-field">
      <legend>{label}{optional && <span> / optional</span>}</legend>
      <div className="road-pair">
        <label>
          <span>Feet</span>
          <input
            id={`${id}-feet`}
            aria-invalid={invalid}
            min="0"
            onChange={(event) => onFeetChange(event.target.value)}
            placeholder={optional ? "Not entered" : "e.g. 20"}
            type="number"
            value={valueFt}
          />
        </label>
        <label>
          <span>Meters</span>
          <input
            aria-invalid={invalid}
            aria-label={`${label} meters`}
            inputMode="decimal"
            onChange={(event) => onMetersChange(event.target.value)}
            placeholder="0.00"
            type="number"
            value={meters}
          />
        </label>
      </div>
    </fieldset>
  );
}

function DesignInput({
  item,
  value,
  locked,
  onValueChange,
  onLockChange,
}: {
  item: RuleDataset["designInputs"][number];
  value: number | undefined;
  locked: boolean;
  onValueChange: (value: string) => void;
  onLockChange: () => void;
}) {
  return (
    <div className="design-input-card">
      <div className="design-input-heading">
        <label htmlFor={`design-${item.id}`}>{item.label}</label>
        {item.hardLockable && (
          <label className="lock-control">
            <input checked={locked} onChange={onLockChange} type="checkbox" />
            Lock
          </label>
        )}
      </div>
      {item.hint && <small className="design-hint">{item.hint}</small>}
      <div className="input-with-unit">
        <input
          id={`design-${item.id}`}
          max={item.max}
          min={item.min ?? 0}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={item.defaultValue === undefined ? "Enter value" : String(item.defaultValue)}
          step={item.step ?? "any"}
          type="number"
          value={value ?? item.defaultValue ?? ""}
        />
        {item.unit && <span>{item.unit}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportSectionCard({
  label,
  fields,
  isConfigured,
}: {
  label: string;
  fields: CalculationResult["reportFields"][ReportSection];
  isConfigured: boolean;
}) {
  return (
    <section className="report-section">
      <h3>{label}</h3>
      {isConfigured ? (
        <div className="report-metrics">
          {fields.map((field) => (
            <Metric
              key={field.id}
              label={field.label}
              value={amountWithUnit(field.value, field.unit, field.precision)}
            />
          ))}
        </div>
      ) : (
        <p className="not-configured compact">
          This section will show after its rules are added to the dataset.
        </p>
      )}
    </section>
  );
}
