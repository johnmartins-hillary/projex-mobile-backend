const { asyncHandler } = require("../middleware");
const { projectRepo } = require("../repositories");
const DocumentRepository = require("../repositories/document.repository");
const {
  generateSignature,
  deleteAsset,
  deleteAssets,
} = require("../services/cloudinary.service");
const { NotFoundError, AppError } = require("../utils/errors");

const documentRepo = new DocumentRepository();

exports.documents = {
  // GET /projects/:projectId/documents/sign
  // Returns a short-lived Cloudinary upload signature for the client
  sign: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const signature = generateSignature("projex/documents");
    res.json({ success: true, data: signature });
  }),

  // GET /projects/:projectId/documents
  getAll: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const { search, category } = req.query;
    const docs = await documentRepo.findByProject(req.params.projectId, {
      search,
      category,
    });
    res.json({ success: true, data: docs });
  }),

  // GET /projects/:projectId/documents/:id
  getOne: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const doc = await documentRepo.findById(
      req.params.id,
      req.params.projectId,
    );
    if (!doc) throw new NotFoundError("Document");

    res.json({ success: true, data: doc });
  }),

  // POST /projects/:projectId/documents
  // Body: { name, description, category, fileUrl, fileName, fileSize, fileType, publicId, notes }
  create: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const {
      name,
      description,
      category,
      fileUrl,
      fileName,
      fileSize,
      fileType,
      publicId,
      notes,
    } = req.body;

    if (!fileUrl || !publicId)
      throw new AppError("File upload data missing", 400);

    const doc = await documentRepo.create(
      {
        projectId: req.params.projectId,
        companyId: req.user.companyId,
        uploadedById: req.user.userId,
        name,
        description,
        category,
      },
      { fileUrl, fileName, fileSize, fileType, publicId, notes },
    );

    res.status(201).json({ success: true, data: doc });
  }),

  // POST /projects/:projectId/documents/:id/versions
  // Body: { fileUrl, fileName, fileSize, fileType, publicId, notes }
  addVersion: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const doc = await documentRepo.findById(
      req.params.id,
      req.params.projectId,
    );
    if (!doc) throw new NotFoundError("Document");

    const { fileUrl, fileName, fileSize, fileType, publicId, notes } = req.body;
    if (!fileUrl || !publicId)
      throw new AppError("File upload data missing", 400);

    const version = await documentRepo.addVersion(
      req.params.id,
      req.user.userId,
      { fileUrl, fileName, fileSize, fileType, publicId, notes },
    );

    res.status(201).json({ success: true, data: version });
  }),

  // DELETE /projects/:projectId/documents/:id
  // Only project owner can delete
  delete: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    const doc = await documentRepo.findById(
      req.params.id,
      req.params.projectId,
    );
    if (!doc) throw new NotFoundError("Document");

    // Only project owner or admin can delete
    if (!["PROJECT_OWNER", "ADMIN", "SUPER_ADMIN"].includes(req.user.role)) {
      throw new AppError("Only project owners can delete documents", 403);
    }

    const publicIds = await documentRepo.deleteDocument(req.params.id);

    // Clean up Cloudinary assets — non-blocking
    deleteAssets(publicIds).catch(() => {});

    res.json({ success: true, message: "Document deleted" });
  }),

  // DELETE /projects/:projectId/documents/:id/versions/:versionId
  deleteVersion: asyncHandler(async (req, res) => {
    const project = await projectRepo.findById(
      req.params.projectId,
      req.user.companyId,
    );
    if (!project) throw new NotFoundError("Project");

    if (!["PROJECT_OWNER", "ADMIN", "SUPER_ADMIN"].includes(req.user.role)) {
      throw new AppError("Only project owners can delete versions", 403);
    }

    const result = await documentRepo.deleteVersion(
      req.params.versionId,
      req.params.id,
    );
    if (!result) throw new NotFoundError("Version");

    // Delete from Cloudinary — non-blocking
    deleteAsset(result.publicId).catch(() => {});

    res.json({
      success: true,
      message: result.documentDeleted
        ? "Version and document deleted (no versions remaining)"
        : "Version deleted",
      data: { documentDeleted: result.documentDeleted },
    });
  }),
};
