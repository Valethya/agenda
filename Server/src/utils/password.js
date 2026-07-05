import bcrypt from "bcryptjs";

export const createHash = async (password) => {
  return await bcrypt.hash(password, 10);
};

export const isValidPassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};
