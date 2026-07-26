const { asyncHandler } = require("../middleware");
const DashboardRepository = require("../repositories/dashboard.repository");

const dashRepo = new DashboardRepository();

exports.dashboard = {
  // GET /api/v1/dashboard?projectId=<uuid>
  getSummary: asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const companyId = req.user.companyId;

    const [
      overview,
      scheduleData,
      workforce,
      materials,
      equipment,
      weeklySpend,
      recentActivity,
      issues,
      latestDiary,
      allProjects,
    ] = await Promise.all([
      dashRepo.getOverview(companyId, projectId).catch((e) => {
        console.error("overview:", e.message);
        return {};
      }),
      dashRepo.getScheduleData(projectId).catch((e) => {
        console.error("schedule:", e.message);
        return null;
      }),
      dashRepo.getWorkforce(companyId, projectId).catch((e) => {
        console.error("workforce:", e.message);
        return {};
      }),
      dashRepo.getMaterials(companyId, projectId).catch((e) => {
        console.error("materials:", e.message);
        return {};
      }),
      dashRepo.getEquipment(companyId).catch((e) => {
        console.error("equipment:", e.message);
        return {};
      }),
      dashRepo.getWeeklySpend(companyId, projectId).catch((e) => {
        console.error("weekly:", e.message);
        return [];
      }),
      dashRepo.getRecentActivity(companyId, projectId).catch((e) => {
        console.error("activity:", e.message);
        return [];
      }),
      dashRepo.getIssues(companyId, projectId).catch((e) => {
        console.error("issues:", e.message);
        return [];
      }),
      dashRepo.getLatestDiary(companyId, projectId).catch((e) => {
        console.error("diary:", e.message);
        return null;
      }),
      dashRepo.getAllProjects(companyId).catch((e) => {
        console.error("projects:", e.message);
        return [];
      }),
    ]);

    res.json({
      success: true,
      data: {
        overview,
        schedule: scheduleData,
        workforce,
        materials,
        equipment,
        weeklySpend, // original key — frontend uses data?.weeklySpend
        weekly_spend: weeklySpend,
        recentActivity, // original key — frontend uses data?.recentActivity
        recent_activities: recentActivity,
        issues,
        latest_site_update: latestDiary,
        projects: allProjects,
      },
    });
  }),
};
