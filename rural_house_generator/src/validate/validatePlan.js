import { validateRoomSizes } from './validateRoomSizes.js';
import { validateFillRate } from './validateFillRate.js';
import { validateConnectivity } from './validateConnectivity.js';
import { validateBathroomAccess } from './validateBathroomAccess.js';
import { validateBedroomPassThrough } from './validateBedroomPassThrough.js';
import { validateKitchenExterior } from './validateKitchenExterior.js';
import { validateWindows } from './validateWindows.js';
import { validateStairGeometry } from './validateStairGeometry.js';
import { validateStairArrival } from './validateStairArrival.js';
import { validateVerticalAlignment } from './validateVerticalAlignment.js';
import { validateTerraceOverlap } from './validateTerraceOverlap.js';
import { validateDoorPriorities } from './validateDoorPriorities.js';
import { validateCorridorNeed } from './validateCorridorNeed.js';

export function validatePlan(plan) {
  const checks = [
    validateRoomSizes(plan),
    validateFillRate(plan),
    validateConnectivity(plan),
    validateBathroomAccess(plan),
    validateBedroomPassThrough(plan),
    validateKitchenExterior(plan),
    validateWindows(plan),
    validateStairGeometry(plan),
    validateStairArrival(plan),
    validateVerticalAlignment(plan),
    validateTerraceOverlap(plan),
    validateDoorPriorities(plan),
    validateCorridorNeed(plan)
  ];

  const hardViolations = checks.flatMap(c => c.hardViolations || []);
  const softPenalties = checks.flatMap(c => c.softPenalties || []);
  return {
    passed: hardViolations.length === 0,
    hardViolations,
    softPenalties,
    scoreBase: 100
  };
}

