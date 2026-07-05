import multer from "multer";

const storage = (folder) => {
  return multer.diskStorage({
    destination: (res, file, cb) => {
      cb(null, `/upload/${folder}`);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + file.originalname);
    },
  });
};

export const uploader = (folder) => {
  return multer({ storage: storage(folder) });
};
