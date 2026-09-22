import { useQuery } from "@tanstack/react-query";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { Location, Plan } from "@/types";

export interface LocationWithPlans {
  location: Location;
  plans: Plan[];
}

export function useCustomerPlans() {
  return useQuery({
    queryKey: ["customer-plans"],
    queryFn: async (): Promise<LocationWithPlans[]> => {
      if (!db) {
        throw new Error("Firebase not configured");
      }

      // Fetch active locations
      const locationsQuery = query(
        collection(db, COLLECTIONS.LOCATIONS),
        where("isActive", "==", true)
      );
      const locationsSnapshot = await getDocs(locationsQuery);
      const locationsData = locationsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Location[];

      // Fetch active plans
      const plansQuery = query(
        collection(db, COLLECTIONS.PLANS),
        where("isActive", "==", true)
      );
      const plansSnapshot = await getDocs(plansQuery);
      const plansData = plansSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Plan[];

      // Group plans by location
      const locationsWithPlans: LocationWithPlans[] = locationsData.map(
        (location) => ({
          location,
          plans: plansData.filter((plan) => plan.locationId === location.id),
        })
      );

      return locationsWithPlans;
    },
    enabled: !!db,
  });
}
