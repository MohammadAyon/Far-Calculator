import { z } from "zod";

const positionSchema = z.tuple([z.number(), z.number()]);
const ringSchema = z.array(positionSchema).min(4).max(20_000);
const polygonSchema = z.array(ringSchema).min(1).max(100);

const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(polygonSchema).min(1).max(100),
  }),
]);

const MAX_CALCULATION_DEPTH = 10;

function calculationExpressionSchemaAtDepth(
  depth: number,
): z.ZodType<CalculationExpression> {
  return z.lazy(() => {
    const constant = z.object({
      type: z.literal("constant"),
      value: z.number().finite(),
    });
    const input = z.object({
      type: z.literal("input"),
      key: z.string().min(1).max(100),
    });
    if (depth >= MAX_CALCULATION_DEPTH) {
      return z.discriminatedUnion("type", [constant, input]);
    }
    return z.discriminatedUnion("type", [
      constant,
      input,
      z.object({
        type: z.literal("operation"),
        operator: z.enum([
          "add",
          "subtract",
          "multiply",
          "divide",
          "min",
          "max",
          "floor",
          "ceil",
        ]),
        operands: z
          .array(calculationExpressionSchemaAtDepth(depth + 1))
          .min(1)
          .max(20),
      }),
    ]);
  });
}

const calculationExpressionSchema =
  calculationExpressionSchemaAtDepth(1);

const incentiveCalculationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), farBonus: z.number().nonnegative() }),
  z.object({
    mode: z.literal("plot-area-tier"),
    tiers: z
      .array(
        z.object({
          minPlotAreaSqft: z.number().nonnegative(),
          maxPlotAreaSqft: z.number().positive().optional(),
          farBonus: z.number().nonnegative(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    mode: z.literal("road-width"),
    thresholdFt: z.number().nonnegative(),
    farPerFoot: z.number().nonnegative(),
    maxFarBonus: z.number().nonnegative(),
  }),
  z.object({
    mode: z.literal("distance-tier"),
    inputId: z.string().min(1).max(80),
    tiers: z
      .array(
        z.object({
          maxDistanceMeters: z.number().positive(),
          farBonus: z.number().nonnegative(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    mode: z.literal("input"),
    inputId: z.string().min(1).max(80),
    maxFarBonus: z.number().nonnegative().optional(),
  }),
]);

const sectionNameSchema = z.enum([
  "far",
  "groundCoverage",
  "setbacks",
  "layout",
  "parking",
  "stairsElevator",
]);

export const ruleDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(120),
    jurisdiction: z.string().trim().min(1).max(120),
    calculationMode: z.enum(["min-area-road-plus-bonus-cap", "dap-2025"]).nullable(),
    areaUnitSqft: z
      .object({
        katha: z.number().positive().optional(),
        decimal: z.number().positive().optional(),
        chatak: z.number().positive().optional(),
        bigha: z.number().positive().optional(),
        acre: z.number().positive().optional(),
        hectare: z.number().positive().optional(),
      })
      .optional(),
    roadFarCombination: z
      .enum(["existing", "proposed", "minimum", "average"])
      .default("existing"),
    plotAreaBasis: z.enum(["gross", "net-after-surrender"]).default("gross"),
    mixedOccupancyCapMethod: z
      .enum(["minimum", "weighted-average"])
      .optional(),
    blocks: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(160),
          zone: z.string().trim().max(80).optional(),
          typeCode: z.string().trim().max(20).optional(),
          areaFar: z.number().nonnegative(),
          areaFarByZone: z.record(z.string(), z.number().nonnegative()).optional(),
          densityPerAcre: z.number().nonnegative().optional(),
          buildable: z.boolean().optional(),
          geometry: geometrySchema.optional(),
        })
        .strict(),
    ).max(500),
    roadFar: z.array(
      z
        .object({
          minRoadWidthFt: z.number().nonnegative(),
          far: z.number().nonnegative().nullable(),
          occupancyCode: z.string().trim().min(1).max(40).optional(),
          zone: z.string().trim().max(80).optional(),
          unrestrictedPlotAreaMinSqft: z.number().positive().optional(),
        })
        .strict(),
    ).max(500),
    occupancies: z.array(
      z
        .object({
          code: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(160),
          group: z.string().trim().max(80).optional(),
          farCap: z.number().positive().nullable().optional(),
          maxGroundCoveragePercent: z.number().min(0).max(100).optional(),
          farTreatment: z.enum(["area-road", "road-only"]).optional(),
        })
        .strict(),
    ).max(50),
    incentives: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(160),
          group: z.string().trim().max(120).optional(),
          automatic: z.boolean().default(false),
          farBonus: z.number().nonnegative().optional(),
          minPlotAreaSqft: z.number().nonnegative().optional(),
          occupancyCodes: z
            .array(z.string().trim().min(1).max(40))
            .max(50)
            .optional(),
          blockTypeCodes: z
            .array(z.string().trim().min(1).max(20))
            .max(500)
            .optional(),
          exclusiveGroup: z.string().trim().min(1).max(80).optional(),
          allowsFarAboveMaximum: z.boolean().default(false),
          calculation: incentiveCalculationSchema.optional(),
        })
        .strict()
        .refine(
          (item) => item.calculation !== undefined || item.farBonus !== undefined,
          { message: "An incentive needs a fixed FAR bonus or a calculation rule." },
        ),
    ).max(100),
    designInputs: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(160),
          section: z.enum(["incentives", "layout", "parking"]),
          unit: z.string().trim().max(40).optional(),
          hint: z.string().trim().max(240).optional(),
          defaultValue: z.number().finite().optional(),
          min: z.number().finite().optional(),
          max: z.number().finite().optional(),
          step: z.number().positive().optional(),
          hardLockable: z.boolean().default(false),
        })
        .strict(),
    ).max(50).default([]),
    reportFields: z.array(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          label: z.string().trim().min(1).max(160),
          section: sectionNameSchema,
          unit: z.string().trim().max(40).optional(),
          precision: z.number().int().min(0).max(6).default(2),
          formula: calculationExpressionSchema,
        })
        .strict(),
    ).max(100).default([]),
    siteCoverage: z
      .object({
        maxTotalGroundCoveragePercent: z.number().min(0).max(100).optional(),
        groundCoverageCapExemptOccupancyCodes: z
          .array(z.string().trim().min(1).max(40))
          .max(50)
          .default([]),
        tiers: z.array(
          z.object({
            minPlotAreaSqft: z.number().nonnegative(),
            maxPlotAreaSqft: z.number().positive().optional(),
            minGroundCoveragePercent: z.number().min(0).max(100).nullable(),
            maxGroundCoveragePercent: z.number().min(0).max(100),
            mandatoryOpenSpacePercent: z.number().min(0).max(100),
            additionalGroundCoveragePercent: z.number().min(0).max(100),
            rainwaterAbsorptionPercent: z.number().min(0).max(100),
          }).strict(),
        ).min(1).max(100),
        occupancyOverrides: z.array(
          z.object({
            occupancyCodes: z
              .array(z.string().trim().min(1).max(40))
              .min(1)
              .max(50),
            minPlotAreaSqft: z.number().nonnegative().optional(),
          minGroundCoveragePercent: z.number().min(0).max(100).nullable().optional(),
            maxGroundCoveragePercent: z.number().min(0).max(100),
            additionalGroundCoveragePercent: z.number().min(0).max(100).optional(),
            mandatoryOpenSpacePercent: z.number().min(0).max(100).optional(),
            rainwaterAbsorptionPercent: z.number().min(0).max(100).optional(),
          }).strict(),
        ).max(100).default([]),
      })
      .strict()
      .optional(),
    roadWidening: z
      .object({
        minRoadWidthFt: z.number().nonnegative(),
        maxRoadWidthFt: z.number().positive(),
        targetRoadWidthFt: z.number().positive(),
        requireSurrenderOnWidening: z.boolean().default(true),
      })
      .strict()
      .optional(),
    surrenderedAreaCompensationFactor: z.number().nonnegative().optional(),
    sources: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
    notes: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  })
  .strict()
  .superRefine((dataset, context) => {
    const uniqueValues = [
      { values: dataset.blocks.map((block) => block.id), path: "blocks" },
      {
        values: dataset.occupancies.map((occupancy) => occupancy.code),
        path: "occupancies",
      },
      {
        values: dataset.incentives.map((incentive) => incentive.id),
        path: "incentives",
      },
      {
        values: dataset.roadFar.map((rule) =>
          [rule.occupancyCode ?? "*", rule.zone ?? "*", rule.minRoadWidthFt].join("|"),
        ),
        path: "roadFar",
      },
      {
        values: dataset.designInputs.map((input) => input.id),
        path: "designInputs",
      },
      {
        values: dataset.reportFields.map((field) => field.id),
        path: "reportFields",
      },
    ];

    for (const { values, path } of uniqueValues) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Entries in this list must have unique identifiers or thresholds.",
        });
      }
    }

    const reservedInputKeys = new Set([
      "plotAreaSqft",
      "netPlotAreaSqft",
      "surrenderedAreaSqft",
      "existingRoadWidthFt",
      "proposedRoadWidthFt",
      "existingRoadFar",
      "proposedRoadFar",
      "areaFar",
      "roadFar",
      "baseFar",
      "farCap",
      "automaticBonusFar",
      "selectedBonusFar",
      "totalBonusFar",
      "calculatedFar",
      "appliedFar",
      "floorAreaSqft",
      "maxGroundCoveragePercent",
      "mandatoryOpenSpacePercent",
      "rainwaterAbsorptionPercent",
      "minGroundCoveragePercent",
      "additionalGroundCoveragePercent",
      "maxGroundCoverageWithExceptionsPercent",
    ]);
    for (const [index, input] of dataset.designInputs.entries()) {
      if (
        reservedInputKeys.has(input.id) ||
        input.id.startsWith("hardLock:") ||
        input.id.startsWith("occupancyShare:")
      ) {
        context.addIssue({
          code: "custom",
          path: ["designInputs", index, "id"],
          message: "This identifier is reserved for a built-in calculation value.",
        });
      }
    }

    if (
      dataset.calculationMode &&
      (!dataset.blocks.length ||
        !dataset.roadFar.length ||
        !dataset.occupancies.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calculationMode"],
        message:
          "A supported calculation model requires blocks, road FAR rules, and occupancies.",
      });
    }

    for (const incentive of dataset.incentives) {
      const calculation = incentive.calculation;
      if (
        calculation?.mode === "distance-tier" &&
        !dataset.designInputs.some(
          (input) => input.id === calculation.inputId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["incentives", incentive.id, "calculation", "inputId"],
          message: "The distance input must be declared in designInputs.",
        });
      }
      if (
        calculation?.mode === "input" &&
        !dataset.designInputs.some(
          (input) => input.id === calculation.inputId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["incentives", incentive.id, "calculation", "inputId"],
          message: "The bonus input must be declared in designInputs.",
        });
      }
    }

    if (
      dataset.roadWidening &&
      dataset.roadWidening.maxRoadWidthFt <= dataset.roadWidening.minRoadWidthFt
    ) {
      context.addIssue({
        code: "custom",
        path: ["roadWidening", "maxRoadWidthFt"],
        message: "The maximum road width must exceed the minimum road width.",
      });
    }
  });

export const calculationInputSchema = z
  .object({
    blockId: z.string().min(1).max(80),
    plotArea: z.number().positive(),
    plotAreaUnit: z.enum([
      "sqft",
      "katha",
      "sqm",
      "decimal",
      "chatak",
      "bigha",
      "acre",
      "hectare",
    ]),
    existingRoadWidthFt: z.number().positive(),
    proposedRoadWidthFt: z.number().nonnegative().nullable(),
    roadWideningNotPossible: z.boolean().default(false),
    surrenderedArea: z.number().nonnegative(),
    surrenderedAreaUnit: z.enum([
      "sqft",
      "katha",
      "sqm",
      "decimal",
      "chatak",
      "bigha",
      "acre",
      "hectare",
    ]),
    occupancyMode: z.enum(["single", "mixed"]),
    occupancyShares: z.array(
      z.object({
        code: z.string().min(1).max(40),
        sharePercent: z.number().positive().max(100),
      }),
    ).min(1).max(50),
    zoneOverride: z.string().nullable(),
    incentiveIds: z.array(z.string().max(80)).max(100).default([]),
    manualFarEnabled: z.boolean().default(false),
    manualFar: z.number().positive().nullable(),
    designValues: z.record(z.string().max(80), z.number().finite()).default({}),
    lockedInputs: z.array(z.string().max(80)).max(50).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.incentiveIds).size !== input.incentiveIds.length) {
      context.addIssue({
        code: "custom",
        path: ["incentiveIds"],
        message: "An incentive can only be selected once.",
      });
    }
    if (new Set(input.lockedInputs).size !== input.lockedInputs.length) {
      context.addIssue({
        code: "custom",
        path: ["lockedInputs"],
        message: "A design input can only be locked once.",
      });
    }
    if (
      new Set(input.occupancyShares.map((item) => item.code)).size !==
      input.occupancyShares.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["occupancyShares"],
        message: "Each occupancy can only be selected once.",
      });
    }
    const totalShare = input.occupancyShares.reduce(
      (total, item) => total + item.sharePercent,
      0,
    );
    if (Math.abs(totalShare - 100) > 0.01) {
      context.addIssue({
        code: "custom",
        path: ["occupancyShares"],
        message: "Occupancy shares must add up to 100%.",
      });
    }
    if (input.occupancyMode === "single" && input.occupancyShares.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["occupancyShares"],
        message: "Single occupancy requires exactly one occupancy.",
      });
    }
    if (input.occupancyMode === "mixed" && input.occupancyShares.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["occupancyShares"],
        message: "Mixed occupancy requires at least two occupancies.",
      });
    }
    if (!input.manualFarEnabled && input.manualFar !== null) {
      context.addIssue({
        code: "custom",
        path: ["manualFar"],
        message: "A manual FAR value requires manual override to be enabled.",
      });
    }
  });

type CalculationExpression =
  | { type: "constant"; value: number }
  | { type: "input"; key: string }
  | {
      type: "operation";
      operator: "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "floor" | "ceil";
      operands: CalculationExpression[];
    };

export type RuleDataset = z.infer<typeof ruleDatasetSchema>;
type CalculationInput = z.infer<typeof calculationInputSchema>;
export type ReportSection = z.infer<typeof sectionNameSchema>;
type ReportFieldValue = {
  id: string;
  label: string;
  value: number | null;
  unit?: string;
  precision: number;
};

export const emptyRuleDataset: RuleDataset = {
  schemaVersion: 1,
  name: "RAJUK rules - data not loaded",
  jurisdiction: "Bangladesh",
  calculationMode: null,
  roadFarCombination: "existing",
  plotAreaBasis: "gross",
  blocks: [],
  roadFar: [],
  occupancies: [],
  incentives: [],
  designInputs: [],
  reportFields: [],
  sources: [],
  notes: [],
};

export type CalculationResult = {
  blockLabel: string;
  zone: string | null;
  occupancyLabels: string[];
  plotAreaSqft: number;
  netPlotAreaSqft: number;
  surrenderedAreaSqft: number;
  existingRoadWidthFt: number;
  proposedRoadWidthFt: number | null;
  roadWideningExceptionUsed: boolean;
  areaFar: number;
  existingRoadFar: number;
  proposedRoadFar: number | null;
  roadFar: number;
  baseFar: number;
  farCap: number | null;
  uncappedFarEligible: boolean;
  automaticBonuses: Array<{ label: string; farBonus: number }>;
  selectedBonuses: Array<{ label: string; farBonus: number }>;
  totalBonusFar: number;
  calculatedFar: number;
  appliedFar: number;
  manualFar: number | null;
  maxFarCap: number | null;
  floorAreaSqft: number;
  siteCoverage: {
    minGroundCoveragePercent: number | null;
    maxGroundCoveragePercent: number;
    maxGroundCoverageWithExceptionsPercent: number;
    groundCoverageSqft: number;
    mandatoryOpenSpacePercent: number;
    mandatoryOpenSpaceSqft: number;
    rainwaterAbsorptionPercent: number;
    rainwaterAbsorptionSqft: number;
  } | null;
  reportFields: Record<ReportSection, ReportFieldValue[]>;
  sources: string[];
};

export class CalculationError extends Error {}

const SQFT_PER_SQM = 10.7639104167;
const FEET_PER_METER = 3.280839895;

function convertAreaToSqft(
  value: number,
  unit: CalculationInput["plotAreaUnit"],
  dataset: RuleDataset,
): number {
  if (unit === "sqft") return value;
  if (unit === "sqm") return value * SQFT_PER_SQM;
  const conversion =
    dataset.areaUnitSqft?.[unit] ?? undefined;
  if (!conversion) {
    throw new CalculationError(
      `The dataset does not define a square-foot conversion for ${unit}.`,
    );
  }
  return value * conversion;
}

type RoadFarValue = { far: number; unrestrictedAvailable: boolean };

function normalizedZone(zone: string | null | undefined): string | undefined {
  if (!zone) return undefined;
  const code = /\bZ[123]\b/i.exec(zone)?.[0];
  return code?.toUpperCase() ?? zone.trim();
}

function findRoadFar(
  widthFt: number,
  dataset: RuleDataset,
  label: string,
  occupancyCode?: string,
  zone?: string | null,
  plotAreaSqft = 0,
): RoadFarValue {
  const zoneCode = normalizedZone(zone);
  const matchingRules = dataset.roadFar
    .filter((rule) => !rule.occupancyCode || rule.occupancyCode === occupancyCode)
    .filter((rule) => !rule.zone || rule.zone === zoneCode)
    .sort((left, right) => left.minRoadWidthFt - right.minRoadWidthFt);
  type DefinedRoadFarRule = RuleDataset["roadFar"][number] & { far: number };
  const usableRules = matchingRules.filter(
    (rule): rule is DefinedRoadFarRule => rule.far !== null,
  );
  const lowerRules = usableRules.filter(
    (rule) => rule.minRoadWidthFt <= widthFt,
  );
  const lowerRule = lowerRules[lowerRules.length - 1];
  const upperRule = usableRules.find((rule) => rule.minRoadWidthFt > widthFt);
  if (!matchingRules.length || !usableRules.length || !lowerRule) {
    throw new CalculationError(
      `No ${label} road FAR rule covers this road width.`,
    );
  }

  const far = upperRule
    ? lowerRule.far +
      ((widthFt - lowerRule.minRoadWidthFt) /
        (upperRule.minRoadWidthFt - lowerRule.minRoadWidthFt)) *
        (upperRule.far - lowerRule.far)
    : lowerRule.far;
  const unrestrictedAvailable = matchingRules.some(
    (rule) =>
      rule.unrestrictedPlotAreaMinSqft !== undefined &&
      rule.minRoadWidthFt <= widthFt &&
      plotAreaSqft >= rule.unrestrictedPlotAreaMinSqft,
  );

  return { far, unrestrictedAvailable };
}

function calculateIncentive(
  incentive: RuleDataset["incentives"][number],
  areaSqft: number,
  roadWidthFt: number,
  designValues: Record<string, number>,
): number {
  const calculation = incentive.calculation;
  if (!calculation) return incentive.farBonus ?? 0;

  if (calculation.mode === "fixed") return calculation.farBonus;
  if (calculation.mode === "plot-area-tier") {
    const matchingTier = calculation.tiers
      .filter(
        (tier) =>
          tier.minPlotAreaSqft <= areaSqft &&
          (tier.maxPlotAreaSqft === undefined ||
            areaSqft < tier.maxPlotAreaSqft),
      )
      .sort((left, right) => right.minPlotAreaSqft - left.minPlotAreaSqft)[0];
    return matchingTier?.farBonus ?? 0;
  }
  if (calculation.mode === "road-width") {
    return Math.min(
      Math.max(0, roadWidthFt - calculation.thresholdFt) *
        calculation.farPerFoot,
      calculation.maxFarBonus,
    );
  }
  if (calculation.mode === "distance-tier") {
    const distance = designValues[calculation.inputId];
    if (distance === undefined) {
      throw new CalculationError(
        `Enter ${incentive.label.toLowerCase()} distance in meters.`,
      );
    }
    return (
      calculation.tiers
        .filter((tier) => distance <= tier.maxDistanceMeters)
        .sort(
          (left, right) => left.maxDistanceMeters - right.maxDistanceMeters,
        )[0]?.farBonus ?? 0
    );
  }

  const value = designValues[calculation.inputId];
  if (value === undefined) {
    throw new CalculationError(`Enter a value for ${incentive.label}.`);
  }
  if (calculation.maxFarBonus !== undefined && value > calculation.maxFarBonus) {
    throw new CalculationError(
      `${incentive.label} exceeds the maximum FAR value in the active dataset.`,
    );
  }
  return value;
}

function evaluateExpression(
  expression: CalculationExpression,
  values: Record<string, number>,
  budget: { remaining: number },
): number {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw new CalculationError("A report formula is too complex to evaluate.");
  }
  if (expression.type === "constant") return expression.value;
  if (expression.type === "input") {
    const value = values[expression.key];
    if (value === undefined || !Number.isFinite(value)) {
      throw new CalculationError(
        `Report formula input "${expression.key}" is unavailable.`,
      );
    }
    return value;
  }

  const operands = expression.operands.map((operand) =>
    evaluateExpression(operand, values, budget),
  );
  let result: number;
  if (expression.operator === "floor" || expression.operator === "ceil") {
    if (operands.length !== 1) {
      throw new CalculationError("A floor/ceil formula needs exactly one operand.");
    }
    result = expression.operator === "floor" ? Math.floor(operands[0]) : Math.ceil(operands[0]);
  } else if (expression.operator === "add") {
    result = operands.reduce((total, value) => total + value, 0);
  } else if (expression.operator === "subtract") {
    result = operands.slice(1).reduce((total, value) => total - value, operands[0]);
  } else if (expression.operator === "multiply") {
    result = operands.reduce((total, value) => total * value, 1);
  } else if (expression.operator === "divide") {
    if (operands.slice(1).some((value) => value === 0)) {
      throw new CalculationError("A report formula attempted to divide by zero.");
    }
    result = operands.slice(1).reduce((total, value) => total / value, operands[0]);
  } else if (expression.operator === "min") {
    result = Math.min(...operands);
  } else {
    result = Math.max(...operands);
  }

  if (!Number.isFinite(result)) {
    throw new CalculationError("A report formula produced an invalid number.");
  }
  return result;
}

function expressionUsesInput(
  expression: CalculationExpression,
  inputKey: string,
): boolean {
  if (expression.type === "input") return expression.key === inputKey;
  return (
    expression.type === "operation" &&
    expression.operands.some((operand) =>
      expressionUsesInput(operand, inputKey),
    )
  );
}

export function calculateFar(
  dataset: RuleDataset,
  input: CalculationInput,
): CalculationResult {
  if (!dataset.calculationMode) {
    throw new CalculationError(
      "The imported dataset does not define a supported calculation model yet.",
    );
  }

  const block = dataset.blocks.find((item) => item.id === input.blockId);
  if (!block) {
    throw new CalculationError("Select a block present in the active dataset.");
  }

  const plotAreaSqft = convertAreaToSqft(input.plotArea, input.plotAreaUnit, dataset);
  const surrenderedAreaSqft = convertAreaToSqft(
    input.surrenderedArea,
    input.surrenderedAreaUnit,
    dataset,
  );
  if (surrenderedAreaSqft > plotAreaSqft) {
    throw new CalculationError("Surrendered road land cannot exceed the plot area.");
  }
  const netPlotAreaSqft = plotAreaSqft - surrenderedAreaSqft;
  const designInputById = new Map(
    dataset.designInputs.map((designInput) => [designInput.id, designInput]),
  );
  const hardLockableInputIds = new Set(
    dataset.designInputs
      .filter((designInput) => designInput.hardLockable)
      .map((designInput) => designInput.id),
  );
  for (const id of input.lockedInputs) {
    if (!hardLockableInputIds.has(id)) {
      throw new CalculationError(`Unknown or non-lockable design input: ${id}.`);
    }
  }
  for (const id of Object.keys(input.designValues)) {
    if (!designInputById.has(id)) {
      throw new CalculationError(`Unknown design input: ${id}.`);
    }
  }
  const effectiveDesignValues: Record<string, number> = {};
  for (const designInput of dataset.designInputs) {
    const value =
      input.designValues[designInput.id] ?? designInput.defaultValue;
    if (value === undefined) continue;
    if (designInput.min !== undefined && value < designInput.min) {
      throw new CalculationError(
        `${designInput.label} is below the minimum in the active dataset.`,
      );
    }
    if (designInput.max !== undefined && value > designInput.max) {
      throw new CalculationError(
        `${designInput.label} exceeds the maximum in the active dataset.`,
      );
    }
    effectiveDesignValues[designInput.id] = value;
  }
  const farAreaSqft =
    dataset.plotAreaBasis === "net-after-surrender"
      ? netPlotAreaSqft
      : plotAreaSqft;

  const areaFar =
    input.zoneOverride && block.areaFarByZone
      ? block.areaFarByZone[input.zoneOverride]
      : block.areaFar;
  if (areaFar === undefined) {
    throw new CalculationError(
      `The selected block has no Area FAR for zone "${input.zoneOverride}".`,
    );
  }
  const occupancyEntries = input.occupancyShares.map((share) => {
    const occupancy = dataset.occupancies.find((item) => item.code === share.code);
    if (!occupancy) {
      throw new CalculationError(
        `Occupancy "${share.code}" is missing from the active dataset.`,
      );
    }
    return { occupancy, sharePercent: share.sharePercent };
  });
  if (input.occupancyMode === "mixed" && !dataset.mixedOccupancyCapMethod) {
    throw new CalculationError(
      "The active dataset does not define how mixed-occupancy FAR caps are combined.",
    );
  }
  if (dataset.calculationMode === "dap-2025" && areaFar <= 0) {
    throw new CalculationError(
      "The selected DAP block is reserved or restricted and has no Area FAR.",
    );
  }

  const widening = dataset.roadWidening;
  if (
    input.roadWideningNotPossible &&
    (!widening ||
      input.existingRoadWidthFt < widening.minRoadWidthFt ||
      input.existingRoadWidthFt >= widening.maxRoadWidthFt)
  ) {
    throw new CalculationError(
      "The Rule 47(7) widening exception only applies to roads in its stated width range.",
    );
  }
  if (
    widening &&
    input.existingRoadWidthFt >= widening.minRoadWidthFt &&
    input.existingRoadWidthFt < widening.maxRoadWidthFt &&
    !input.roadWideningNotPossible &&
    (input.proposedRoadWidthFt === null ||
      input.proposedRoadWidthFt < widening.targetRoadWidthFt)
  ) {
    throw new CalculationError(
      `The DAP requires this road to be widened to at least ${widening.targetRoadWidthFt.toFixed(2)} ft. Enter the proposed width and surrendered land area.`,
    );
  }
  if (
    dataset.calculationMode === "dap-2025" &&
    widening &&
    block.typeCode !== "O" &&
    input.existingRoadWidthFt < widening.minRoadWidthFt &&
    (input.proposedRoadWidthFt === null ||
      input.proposedRoadWidthFt < widening.targetRoadWidthFt)
  ) {
    throw new CalculationError(
      `Roads narrower than 2.5 m are only allowed for Old Dhaka blocks. Enter a proposed width of at least ${widening.targetRoadWidthFt.toFixed(2)} ft.`,
    );
  }
  if (
    widening &&
    input.roadWideningNotPossible &&
    input.proposedRoadWidthFt !== null &&
    input.existingRoadWidthFt >= widening.minRoadWidthFt &&
    input.existingRoadWidthFt < widening.maxRoadWidthFt
  ) {
    throw new CalculationError(
      "Clear the proposed width when using the rule's road-widening-impossible exception.",
    );
  }
  if (
    widening &&
    input.proposedRoadWidthFt !== null &&
    input.proposedRoadWidthFt < input.existingRoadWidthFt
  ) {
    throw new CalculationError(
      "A proposed road width cannot be narrower than the existing road width.",
    );
  }
  if (
    widening?.requireSurrenderOnWidening &&
    input.proposedRoadWidthFt !== null &&
    input.proposedRoadWidthFt > input.existingRoadWidthFt &&
    surrenderedAreaSqft <= 0
  ) {
    throw new CalculationError(
      "Enter the land area surrendered for the proposed road widening.",
    );
  }

  const dapMode = dataset.calculationMode === "dap-2025";
  const effectiveZone = input.zoneOverride ?? block.zone ?? null;
  const roadValues = occupancyEntries.map(({ occupancy, sharePercent }) => {
    const existing = findRoadFar(
      input.existingRoadWidthFt,
      dataset,
      "existing-road",
      dapMode ? occupancy.code : undefined,
      effectiveZone,
      plotAreaSqft,
    );
    const proposed =
      input.proposedRoadWidthFt === null || input.proposedRoadWidthFt === 0
        ? null
        : findRoadFar(
            input.proposedRoadWidthFt,
            dataset,
            "proposed-road",
            dapMode ? occupancy.code : undefined,
            effectiveZone,
            plotAreaSqft,
          );

    let roadFarValue: number;
    if (dataset.roadFarCombination === "proposed") {
      if (proposed === null) {
        throw new CalculationError(
          "A proposed road width is required by the active FAR rules.",
        );
      }
      roadFarValue = proposed.far;
    } else if (dataset.roadFarCombination === "minimum") {
      roadFarValue = proposed === null
        ? existing.far
        : Math.min(existing.far, proposed.far);
    } else if (dataset.roadFarCombination === "average") {
      roadFarValue = proposed === null
        ? existing.far
        : (existing.far + proposed.far) / 2;
    } else {
      roadFarValue = existing.far;
    }

    const unrestrictedAvailable =
      existing.unrestrictedAvailable || Boolean(proposed?.unrestrictedAvailable);
    const areaRoadTreatment = occupancy.farTreatment !== "road-only";
    const base = areaRoadTreatment
      ? unrestrictedAvailable
        ? areaFar
        : Math.min(areaFar, roadFarValue)
      : roadFarValue;
    const maximum = areaRoadTreatment
      ? Math.max(areaFar, roadFarValue)
      : roadFarValue;
    return {
      occupancy,
      sharePercent,
      existingRoadFar: existing.far,
      proposedRoadFar: proposed?.far ?? null,
      roadFar: roadFarValue,
      baseFar: base,
      maximumFar: maximum,
      unrestrictedAvailable,
    };
  });

  const weightedValue = (key: "existingRoadFar" | "roadFar" | "baseFar") =>
    roadValues.reduce(
      (total, item) => total + item[key] * (item.sharePercent / 100),
      0,
    );
  const existingRoadFar = weightedValue("existingRoadFar");
  const proposedRoadFar = roadValues.some((item) => item.proposedRoadFar !== null)
    ? roadValues.reduce(
        (total, item) =>
          total + (item.proposedRoadFar ?? 0) * (item.sharePercent / 100),
        0,
      )
    : null;
  const roadFar = weightedValue("roadFar");
  const baseFar = dapMode
    ? weightedValue("baseFar")
    : Math.min(areaFar, roadFar);
  const uncappedFarEligible = dapMode && roadValues.every(
    (item) => item.unrestrictedAvailable,
  );

  let farCap: number | null;
  if (dapMode) {
    farCap = uncappedFarEligible
      ? null
      : roadValues.reduce(
          (total, item) => total + item.maximumFar * (item.sharePercent / 100),
          0,
        );
  } else {
    const capValues = occupancyEntries.map(({ occupancy }) => occupancy.farCap);
    farCap = null;
    if (capValues.every((value) => value !== undefined && value !== null)) {
      const definedCaps = capValues as number[];
      farCap =
        input.occupancyMode === "mixed" &&
        dataset.mixedOccupancyCapMethod === "weighted-average"
          ? occupancyEntries.reduce(
              (total, entry, index) =>
                total + definedCaps[index] * (entry.sharePercent / 100),
              0,
            )
          : Math.min(...definedCaps);
    }
  }

  const automaticBonuses = dataset.incentives
    .filter((incentive) => incentive.automatic)
    .flatMap((incentive) => {
      if (
        incentive.minPlotAreaSqft !== undefined &&
        farAreaSqft < incentive.minPlotAreaSqft
      ) {
        return [];
      }
      if (
        incentive.occupancyCodes &&
        !occupancyEntries.every((entry) =>
          incentive.occupancyCodes?.includes(entry.occupancy.code),
        )
      ) {
        return [];
      }
      if (
        incentive.blockTypeCodes &&
        !incentive.blockTypeCodes.includes(block.typeCode ?? "")
      ) {
        return [];
      }
      const farBonus = calculateIncentive(
        incentive,
        farAreaSqft,
        input.existingRoadWidthFt,
        effectiveDesignValues,
      );
      return farBonus > 0 ? [{ label: incentive.label, farBonus }] : [];
    });

  const selectedIncentives = input.incentiveIds.map((id) => {
    const incentive = dataset.incentives.find((item) => item.id === id);
    if (!incentive || incentive.automatic) {
      throw new CalculationError(`Unknown or automatic incentive: ${id}.`);
    }
    return incentive;
  });
  const selectedExclusiveGroups = selectedIncentives
    .map((incentive) => incentive.exclusiveGroup)
    .filter((group): group is string => Boolean(group));
  if (new Set(selectedExclusiveGroups).size !== selectedExclusiveGroups.length) {
    throw new CalculationError(
      "Only one incentive from each mutually exclusive group may be selected.",
    );
  }

  const selectedBonuses = selectedIncentives.map((incentive) => {
    if (
      incentive.minPlotAreaSqft !== undefined &&
      farAreaSqft < incentive.minPlotAreaSqft
    ) {
      throw new CalculationError(
        `${incentive.label} requires a larger plot under the active dataset.`,
      );
    }
    if (
      incentive.occupancyCodes &&
      !occupancyEntries.every((entry) =>
        incentive.occupancyCodes?.includes(entry.occupancy.code),
      )
    ) {
      throw new CalculationError(
        `${incentive.label} does not apply to the selected occupancy mix.`,
      );
    }
    if (
      incentive.blockTypeCodes &&
      !incentive.blockTypeCodes.includes(block.typeCode ?? "")
    ) {
      throw new CalculationError(
        `${incentive.label} does not apply to this DAP block type.`,
      );
    }
    return {
      label: incentive.label,
      farBonus: calculateIncentive(
        incentive,
        farAreaSqft,
        input.existingRoadWidthFt,
        effectiveDesignValues,
      ),
    };
  });

  const totalBonusFar = [...automaticBonuses, ...selectedBonuses].reduce(
    (total, bonus) => total + bonus.farBonus,
    0,
  );
  const aboveMaximumBonusFar = selectedBonuses.reduce(
    (total, bonus, index) =>
      total +
      (selectedIncentives[index].allowsFarAboveMaximum ? bonus.farBonus : 0),
    0,
  );
  const regularBonusFar = totalBonusFar - aboveMaximumBonusFar;
  let calculatedFar: number;
  if (farCap === null) {
    calculatedFar = baseFar + totalBonusFar;
  } else {
    const standardCalculatedFar =
      dapMode && farCap - baseFar <= 0.1
        ? farCap
        : Math.min(baseFar + regularBonusFar, farCap);
    const eligibleFarExcess =
      dapMode && standardCalculatedFar >= farCap - 1e-9
        ? Math.min(aboveMaximumBonusFar, 0.5)
        : 0;
    calculatedFar = standardCalculatedFar + eligibleFarExcess;
  }
  if (input.manualFarEnabled && input.manualFar === null) {
    throw new CalculationError("Enter the manual FAR override value.");
  }
  if (
    input.manualFarEnabled &&
    farCap !== null &&
    input.manualFar !== null &&
    input.manualFar > farCap &&
    (!dapMode || input.manualFar > calculatedFar)
  ) {
    throw new CalculationError(
      `Manual FAR cannot exceed the active occupancy cap of ${farCap}.`,
    );
  }
  if (
    dapMode &&
    input.manualFarEnabled &&
    input.manualFar !== null &&
    input.manualFar > calculatedFar &&
    !uncappedFarEligible
  ) {
    throw new CalculationError(
      "Manual FAR cannot exceed the base FAR plus eligible incentives under the DAP maximum FAR rule.",
    );
  }
  const appliedFar =
    input.manualFarEnabled && input.manualFar !== null
      ? input.manualFar
      : calculatedFar;
  const floorAreaSqft =
    (farAreaSqft +
      surrenderedAreaSqft * (dataset.surrenderedAreaCompensationFactor ?? 0)) *
    appliedFar;

  const coverageTier = dataset.siteCoverage?.tiers
    .filter(
      (tier) =>
        tier.minPlotAreaSqft <= farAreaSqft &&
        (tier.maxPlotAreaSqft === undefined ||
          farAreaSqft < tier.maxPlotAreaSqft),
    )
    .sort((left, right) => right.minPlotAreaSqft - left.minPlotAreaSqft)[0];
  let siteCoverage: CalculationResult["siteCoverage"] = null;
  let additionalCoveragePercentForReports = 0;
  const siteCoverageRules = dataset.siteCoverage;
  if (coverageTier && siteCoverageRules) {
    const coverageOverride = siteCoverageRules.occupancyOverrides.find(
      (override) =>
        (override.minPlotAreaSqft === undefined ||
          farAreaSqft >= override.minPlotAreaSqft) &&
        occupancyEntries.every((entry) =>
          override.occupancyCodes.includes(entry.occupancy.code),
        ),
    );
    const maxGroundCoveragePercent =
      coverageOverride?.maxGroundCoveragePercent ??
      coverageTier.maxGroundCoveragePercent;
    const additionalGroundCoveragePercent =
      coverageOverride?.additionalGroundCoveragePercent ??
      coverageTier.additionalGroundCoveragePercent;
    additionalCoveragePercentForReports = additionalGroundCoveragePercent;
    const mandatoryOpenSpacePercent =
      coverageOverride?.mandatoryOpenSpacePercent ??
      coverageTier.mandatoryOpenSpacePercent;
    const rainwaterAbsorptionPercent =
      coverageOverride?.rainwaterAbsorptionPercent ??
      coverageTier.rainwaterAbsorptionPercent;
    const coverageWithExceptions =
      maxGroundCoveragePercent + additionalGroundCoveragePercent;
    const coverageCap = siteCoverageRules.maxTotalGroundCoveragePercent;
    const coverageCapApplies =
      coverageCap !== undefined &&
      !occupancyEntries.every((entry) =>
        siteCoverageRules.groundCoverageCapExemptOccupancyCodes.includes(
          entry.occupancy.code,
        ),
      );
    siteCoverage = {
      minGroundCoveragePercent:
        coverageOverride?.minGroundCoveragePercent !== undefined
          ? coverageOverride.minGroundCoveragePercent
          : coverageTier.minGroundCoveragePercent,
      maxGroundCoveragePercent,
      maxGroundCoverageWithExceptionsPercent:
        coverageCapApplies
          ? Math.min(
              coverageWithExceptions,
              coverageCap,
            )
          : coverageWithExceptions,
      groundCoverageSqft: farAreaSqft * (maxGroundCoveragePercent / 100),
      mandatoryOpenSpacePercent,
      mandatoryOpenSpaceSqft:
        farAreaSqft * (mandatoryOpenSpacePercent / 100),
      rainwaterAbsorptionPercent,
      rainwaterAbsorptionSqft:
        farAreaSqft * (rainwaterAbsorptionPercent / 100),
    };
  }

  const contextValues: Record<string, number> = {
    plotAreaSqft,
    netPlotAreaSqft,
    surrenderedAreaSqft,
    existingRoadWidthFt: input.existingRoadWidthFt,
    existingRoadFar,
    areaFar,
    roadFar,
    baseFar,
    automaticBonusFar: automaticBonuses.reduce(
      (total, item) => total + item.farBonus,
      0,
    ),
    selectedBonusFar: selectedBonuses.reduce(
      (total, item) => total + item.farBonus,
      0,
    ),
    totalBonusFar,
    calculatedFar,
    appliedFar,
    floorAreaSqft,
  };
  if (input.proposedRoadWidthFt !== null) {
    contextValues.proposedRoadWidthFt = input.proposedRoadWidthFt;
  }
  if (proposedRoadFar !== null) {
    contextValues.proposedRoadFar = proposedRoadFar;
  }
  if (farCap !== null) contextValues.farCap = farCap;
  if (siteCoverage) {
    contextValues.maxGroundCoveragePercent =
      siteCoverage.maxGroundCoveragePercent;
    contextValues.mandatoryOpenSpacePercent =
      siteCoverage.mandatoryOpenSpacePercent;
    contextValues.rainwaterAbsorptionPercent =
      siteCoverage.rainwaterAbsorptionPercent;
    contextValues.minGroundCoveragePercent =
      siteCoverage.minGroundCoveragePercent ?? 0;
    contextValues.additionalGroundCoveragePercent =
      additionalCoveragePercentForReports;
    contextValues.maxGroundCoverageWithExceptionsPercent =
      siteCoverage.maxGroundCoverageWithExceptionsPercent;
  }
  for (const share of input.occupancyShares) {
    contextValues[`occupancyShare:${share.code}`] = share.sharePercent;
  }
  Object.assign(contextValues, effectiveDesignValues);
  for (const designInput of dataset.designInputs) {
    contextValues[`hardLock:${designInput.id}`] =
      input.lockedInputs.includes(designInput.id) ? 1 : 0;
  }

  const reportFields: CalculationResult["reportFields"] = {
    far: [],
    groundCoverage: [],
    setbacks: [],
    layout: [],
    parking: [],
    stairsElevator: [],
  };
  for (const field of dataset.reportFields) {
    reportFields[field.section].push({
      id: field.id,
      label: field.label,
      value:
        farCap === null && expressionUsesInput(field.formula, "farCap")
          ? null
          : evaluateExpression(field.formula, contextValues, { remaining: 500 }),
      unit: field.unit,
      precision: field.precision,
    });
  }

  return {
    blockLabel: block.label,
    zone: input.zoneOverride ?? block.zone ?? null,
    occupancyLabels: occupancyEntries.map(
      ({ occupancy, sharePercent }) =>
        input.occupancyMode === "mixed"
          ? `${occupancy.code} (${sharePercent}%) - ${occupancy.label}`
          : `${occupancy.code} - ${occupancy.label}`,
    ),
    plotAreaSqft,
    netPlotAreaSqft,
    surrenderedAreaSqft,
    existingRoadWidthFt: input.existingRoadWidthFt,
    proposedRoadWidthFt: input.proposedRoadWidthFt,
    roadWideningExceptionUsed: input.roadWideningNotPossible,
    areaFar,
    existingRoadFar,
    proposedRoadFar,
    roadFar,
    baseFar,
    farCap,
    uncappedFarEligible,
    automaticBonuses,
    selectedBonuses,
    totalBonusFar,
    calculatedFar,
    appliedFar,
    manualFar: input.manualFarEnabled ? input.manualFar : null,
    maxFarCap: farCap,
    floorAreaSqft,
    siteCoverage,
    reportFields,
    sources: dataset.sources,
  };
}

export const areaUnits = [
  { value: "sqft", label: "Square feet (sq ft)" },
  { value: "katha", label: "Katha" },
  { value: "sqm", label: "Square meters (sq m)" },
  { value: "decimal", label: "Shotangsho / Decimal" },
  { value: "chatak", label: "Chatak" },
  { value: "bigha", label: "Bigha / Paki" },
  { value: "acre", label: "Acre" },
  { value: "hectare", label: "Hectare" },
] as const;

export const sqftPerSqm = SQFT_PER_SQM;
export const feetPerMeter = FEET_PER_METER;
