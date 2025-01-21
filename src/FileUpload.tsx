/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Progress, Button, Row, message } from "antd";
import Card from "antd/es/card";
import {
  CheckCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons/lib/icons";
import Title from "antd/es/typography/Title";
import img from "./assets/images/uploadFile.png";
import img6 from "./assets/images/upload-file.png";

const FileUpload = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploadStatuses, setUploadStatuses] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number[]>([]),
    [uploading, setUploading] = useState(false);

  const [deletedUIDs, setDeletedUIDs] = useState<Set<string>>(new Set());

  const handleFileChange = (info: any) => {
    const { fileList } = info;
    const filteredFiles = fileList.filter(
      (file: any) => !deletedUIDs.has(file?.uid)
    );
    const uniqueFiles: any = [];
    const fileNames = new Set();

    filteredFiles.forEach((file: any) => {
      if (!deletedUIDs.has(file?.uid) && !fileNames.has(file.name)) {
        uniqueFiles.push(file);
        fileNames.add(file.name);
      }
    });

    const selectedFiles = uniqueFiles.map((file: any) => file.originFileObj);

    setFiles(selectedFiles);
    setUploadStatuses(() => [...selectedFiles.map(() => "Pending")]);
    setUploadProgress(() => [...selectedFiles.map(() => 0)]);
  };

  const getUserIpAddress = async () => {
    try {
      const response = await axios.get("https://api.ipify.org?format=json");
      return response.data;
    } catch (error) {
      console.error("Error fetching IP address", error);
      return { ipRange: { start: "" } };
    }
  };

  const generateSasToken = async (
    fileName: any,
    fileSizeInBytes: any,
    uploadSpeedInMbps: any,
    ipRange: any,
    increaseExpiration: boolean = false
  ) => {
    try {
      const estimatedUploadTimeInSeconds = fileSizeInBytes / uploadSpeedInMbps;
      const bufferInSeconds = estimatedUploadTimeInSeconds * 0.1;
      const totalExpirationTimeInSeconds =
        estimatedUploadTimeInSeconds + bufferInSeconds;

      let totalExpirationTimeInMinutes = totalExpirationTimeInSeconds / 60;
      if (increaseExpiration) {
        totalExpirationTimeInMinutes *= 90;
      }

      const requestPayload = {
        fileName: fileName,
        expiryMinutes: totalExpirationTimeInMinutes,
        // expiryMinutes: 3,
        ipRange: {
          start: ipRange,
        },
      };

      const response = await axios.post(
        "https://uploadiprestrictedfile-esa4edbqbfc9dabf.centralindia-01.azurewebsites.net/blob-storage/generate-sas-token",
        requestPayload
      );
      if (response?.data?.sasUrl) {
        return response.data.sasUrl;
      } else {
        throw new Error("Failed to generate SAS URL: Invalid response format");
      }
    } catch (error: any) {
      console.error("Error generating SAS URL:", error.message || error);
      throw error;
    }
  };

  const getInternetSpeed = () => {
    return new Promise((resolve, reject) => {
      if (navigator.connection) {
        const { downlink, effectiveType } = navigator.connection;
        console.log(`Connection type: ${effectiveType}`);
        console.log(`Estimated uploading  speed: ${downlink} Mbps`);
        resolve(downlink);
      } else {
        console.log(
          "Network Information API is not supported in this browser."
        );
        reject("Network Information API is not supported in this browser.");
      }
    });
  };

  const extractSIPFromURL = (sasUrl: string): string | null => {
    const url = new URL(sasUrl);
    const sip = url.searchParams.get("sip");
    return sip;
  };
  const compareIPAndGenerateSasToken = async (
    sasUrl: string,
    ipRange: string
  ) => {
    try {
      const extractedSIP = extractSIPFromURL(sasUrl);
      if (extractedSIP === ipRange) {
        console.log("IP matches. SAS token is valid.");
        return sasUrl;
      } else {
        throw new Error(
          "Uploading file from a different network is not allowed."
        );
      }
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  };

  const updateStatus = (index: any, status: any) => {
    setUploadStatuses((prev) => {
      const newStatuses = [...prev];
      newStatuses[index] = status;
      return newStatuses;
    });
  };

  const handleRetry = async (
    file: any,
    retries: any,
    ipRange: any,
    checkSpeed: any,
    sasUrl: any,
    index: any
  ) => {
    let response;
    while (retries > 0) {
      try {
        response = await axios.put(sasUrl, file, {
          headers: {
            "x-ms-blob-type": "BlockBlob",
            "Content-Type": file.type,
          },
          timeout: 40000,

          onUploadProgress: (prog: any) => {
            const percentCompleted = Math.round(
              (prog.loaded / prog.total) * 100
            );
            setUploadProgress((prev) => {
              const newProgress = [...prev];
              newProgress[index] = percentCompleted;
              return newProgress;
            });
          },
        });
        if (response.status === 201) {
          updateStatus(index, "Success");
          return true;
        } else {
          message.error(`Unexpected status code: ${response.status}`);
          break;
        }
      } catch (error: any) {
        if (error?.response?.status === 403) {
          console.warn("403 Forbidden: Retrying with increased expiry time...");
          sasUrl = await generateSasToken(
            file.name,
            file.size,
            checkSpeed,
            ipRange.ip,
            true
          );
          retries--;
        } else {
          break;
        }
      }
    }
    return false;
  };

  const handleUpload = async (file: File, index: number) => {
    if (!file) {
      message.error("File data is missing");
      updateStatus(index, "Failed");
      return;
    }
    if (file?.name?.endsWith(".zip")) {
      message.error("ZIP files are not allowed");
      updateStatus(index, "Failed");
      return;
    }
    const retries = 3;

    try {
      const ipRange = await getUserIpAddress();
      if (!ipRange) {
        throw new Error("Could not retrieve user IP address");
      }

      const checkSpeed = await getInternetSpeed();
      const sasUrl = await generateSasToken(
        file.name,
        file.size,
        checkSpeed,
        ipRange.ip
      );

      if (sasUrl) {
        await compareIPAndGenerateSasToken(sasUrl, ipRange.ip);
      }

      const success = await handleRetry(
        file,
        retries,
        ipRange,
        checkSpeed,
        sasUrl,
        index
      );

      if (!success) {
        updateStatus(index, "Failed");
      }
    } catch (error: any) {
      updateStatus(index, "Failed");
      console.log(error);
    }
  };

  const handleUploadAll = () => {
    setUploading(true);
    files.forEach((file, index) => {
      handleUpload(file, index);
    });
  };

  const handleDelete = (uid: any) => {
    const updatedFiles = files.filter((file: any) => file.uid !== uid);
    setDeletedUIDs((prev) => new Set(prev).add(uid));
    setFiles(updatedFiles);
  };

  const fileCategories = [
    {
      title: "Document and Text Files",
      examples: [".txt", ".doc", ".pdf", ".md", ".rtf"],
      icon: "📄",
    },
    {
      title: "Media Files",
      examples: [".jpg", ".mp3", ".mp4", ".png", ".gif"],
      icon: "🎬",
    },
    {
      title: "Web Development Files",
      examples: [".html", ".css", ".js", ".jsx", ".tsx"],
      icon: "🌐",
    },
    {
      title: "System and Code Files",
      examples: [".exe", ".dll", ".py", ".java", ".cpp"],
      icon: "⚙️",
    },
    {
      title: "Data Storage and Compressed Files",
      examples: [".rar", ".sql", ".csv", ".json", ".xslx"],
      icon: "📦",
    },
  ];
  return (
    <div style={{ padding: "10px" }}>
      <Card
        title={
          <Title
            level={4}
            style={{
              fontSize: "1.2rem",
              fontWeight: "bold",
              marginBottom: "8px",
              color: "rgb(235 168 0)",
            }}
          >
            UPLOAD FILES
          </Title>
        }
        style={{
          maxWidth: 400,
          margin: "auto",
          borderRadius: "6px",
          boxShadow: "0px 2px 6px rgba(0, 0, 0, 0.1)",
          animation: "pop-up 0.5s ease-in-out",
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Upload.Dragger
            multiple
            showUploadList={false}
            onChange={(e: any) => {
              handleFileChange(e);
            }}
            accept=".pdf,.doc,.docx,.txt, .xls, .xlsx, .ppt, .pptx, .jpg, .png, .gif, .csv, .html, .json,  .xml, .bmp, .webp,.tif"
            beforeUpload={() => false}
            style={{
              marginBottom: 16,
              backgroundColor: "white",
              borderRadius: "12px",
              boxShadow: "0px 2px 6px rgba(0, 0, 0, 0.1)",
              border: "1px dashed grey",
              padding: "10px",
            }}
          >
            <p className="ant-upload-drag-icon">
              <div className="gx-user-wid gx-mr-3">
                <img
                  alt="uploadfile"
                  src={img}
                  className="gx-object-cover"
                  width="300" // Reduced image size
                />
              </div>
            </p>
            <p className="ant-upload-text">
              <span style={{ fontSize: "1rem", fontWeight: "normal" }}>
                Drag and drop <br />
              </span>
              <span
                style={{
                  fontSize: "0.9rem",
                  color: "grey",
                  fontFamily: "'Poppins', sans-serif",
                  fontStyle: "normal",
                  textTransform: "capitalize",
                }}
              >
                Your files here, or Browse to upload
              </span>
            </p>
          </Upload.Dragger>

          <div>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "space-between",
                width: "100%",
                maxWidth: "1200px",
              }}
            >
              {fileCategories.map((category, index) => (
                <motion.div
                  key={index}
                  style={{
                    position: "relative",
                    width: "200px",
                    height: "80px",
                    backgroundColor: "#fff",
                    borderRadius: "8px",
                    overflow: "hidden",
                    boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)",
                    cursor: "pointer",
                    marginBottom: "1rem",
                  }}
                  whileHover={{
                    scale: 1.05,
                    width: "500px",
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <motion.div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      fontSize: "48px",
                    }}
                    initial={{ opacity: 1 }}
                    whileHover={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {category.icon}
                  </motion.div>

                  <motion.div
                    style={{
                      position: "absolute",
                      top: "33%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      opacity: 0,
                      width: "100%",
                      padding: "1rem",
                      textAlign: "center",
                      transition: "opacity 0.3s ease",
                    }}
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                  >
                    <Title
                      level={5}
                      style={{
                        fontSize: "10px",
                        color: "rgb(235 168 0)",
                      }}
                    >
                      {category.title}
                    </Title>
                    <div
                      style={{
                        fontSize: "11px",
                        marginBottom: "22px",
                        color: "blue",
                      }}
                    >
                      {category.examples.map((ext, i) => (
                        <span key={i}>{ext}</span>
                      ))}
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>
          <Button
            type="primary"
            onClick={handleUploadAll}
            style={{ width: "100%" }}
            disabled={files?.length === 0}
          >
            Upload file
          </Button>
        </motion.div>

        <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
          {files?.map((file: any, index) => {
            return (
              <AnimatePresence>
                <motion.div
                  key={file.name}
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -50 }}
                  transition={{ duration: 0.5 }}
                  className="mt-4"
                >
                  <Card
                    style={{
                      width: "348px",
                      height: "50px",
                      marginLeft: "10px",
                      padding: "4px 12px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span
                        className="text-sm font-medium truncate"
                        title={file.name}
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "88%",
                          textAlign: "left",
                        }}
                      >
                        <img
                          alt="uploadfile"
                          src={img6}
                          className="gx-object-cover"
                          width={20}
                          style={{ marginRight: "18px" }}
                        />
                        {file.name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {uploadStatuses[index] === "Success" && (
                          <CheckCircleOutlined
                            style={{ fontSize: 16, color: "#52c41a" }}
                          />
                        )}

                        {uploadStatuses[index] !== "Success" && (
                          <DeleteOutlined
                            onClick={() => handleDelete(file?.uid)}
                            style={{
                              color: "red",
                              cursor: "pointer",
                              fontSize: "16px",
                              marginLeft: "8px",
                            }}
                            title="Soft Delete"
                          />
                        )}
                      </div>
                    </div>

                    {uploading && (
                      <Progress
                        percent={uploadProgress[index]}
                        size="small"
                        status={
                          uploadStatuses[index] === "Failed"
                            ? "exception"
                            : "active"
                        }
                        strokeColor={
                          uploadStatuses[index] === "Success"
                            ? "#52c41a"
                            : "#1890ff"
                        }
                        style={{
                          width: "100%",
                        }}
                      />
                    )}
                  </Card>
                </motion.div>
              </AnimatePresence>
            );
          })}
        </Row>
      </Card>
    </div>
  );
};

export default FileUpload;
