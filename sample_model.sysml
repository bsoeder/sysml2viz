package JointHumanitarianAssistanceMission {
  doc "A sample SysML2-style mission model rendered into operational, structural, and behavioral views."

  part def MissionSystem {
    attribute missionId : String;
    attribute status : MissionStatus;
    operation planSortie();
    operation allocateSupplies();

    part planner : MissionPlanner;
    part airCell : AirDeliveryCell;
    part seaCell : SeaDeliveryCell;
    part supportCell : SustainmentCell;

    connect planner.ordersOut -> airCell.ordersIn "airTasking";
    connect planner.ordersOut -> seaCell.ordersIn "seaTasking";
    connect airCell.statusOut -> supportCell.demandIn "replenishmentRequest";
    connect seaCell.statusOut -> supportCell.demandIn "cargoConsumption";
  }

  part def MissionPlanner {
    port ordersOut;
  }

  part def AirDeliveryCell {
    port ordersIn;
    port statusOut;
  }

  part def SeaDeliveryCell {
    port ordersIn;
    port statusOut;
  }

  part def SustainmentCell {
    port demandIn;
  }

  part def JointTaskForce {
    attribute role : String;
  }

  part def AirAsset {
    attribute tailNumber : String;
    attribute payloadCapacityKg : Real;
    operation launch();
    operation deliver();
  }

  part def SeaAsset {
    attribute hullNumber : String;
    attribute berthCapacity : Integer;
    operation sail();
    operation offload();
  }

  part def ReliefAgency {
    attribute region : String;
  }

  part def AffectedPopulation {
    attribute location : String;
  }

  item def ReliefPackage {
    attribute priority : Integer;
    attribute massKg : Real;
    operation inspect();
  }

  part jtf : JointTaskForce;
  part airwing : AirAsset;
  part sealift : SeaAsset;
  part relief : ReliefAgency;
  part population : AffectedPopulation;

  flow jtf -> airwing "Tasking Orders";
  flow jtf -> sealift "Tasking Orders";
  flow airwing -> relief "Rapid Airlift";
  flow sealift -> relief "Bulk Sustainment";
  flow relief -> population "Food / Water / Medical Aid";

  action def ReliefSortie {
    start start;
    action assessDemand;
    action planSortiePackage;
    action loadReliefSupplies;
    decision weatherAcceptable;
    action launchMission;
    action replanRouteTiming;
    end complete;

    flow start -> assessDemand;
    flow assessDemand -> planSortiePackage;
    flow planSortiePackage -> loadReliefSupplies;
    flow loadReliefSupplies -> weatherAcceptable;
    flow weatherAcceptable -> launchMission "yes";
    flow weatherAcceptable -> replanRouteTiming "no";
    flow replanRouteTiming -> planSortiePackage;
    flow launchMission -> complete;
  }
}
