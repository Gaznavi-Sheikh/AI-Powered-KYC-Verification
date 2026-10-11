# Dataset Information

This document lists the external datasets used to train the document-classification
model (and related preprocessing/experimentation) for the AI-Powered KYC Compliance
project. The raw image datasets are **not included in this repository** — they are
large (hundreds of MB to several GB) and are instead linked below for anyone who
wants to inspect them or retrain the model from scratch.

These datasets are provided strictly for **academic and research purposes** related
to this internship project.

## 1. KYC Compliance Datasets (Aadhaar / PAN / Passport)

**Link:** https://drive.google.com/drive/folders/142P4tXnejQtmOLr1yyYD0tJybWjn4vmQ?usp=sharing

A parent Google Drive folder ("datasets for AI KYC compliance") containing three
subfolders, one per supported document type:

- `Aadhar Detection`
- `Pan Card Detection`
- `Passport Detection`

This is the primary source of identity-document images used for the CNN document
classifier.

## 2. Generated Aadhaar Card Images (augmented)

**Link:** https://drive.google.com/drive/folders/1PH1jHLOZkNG6T1Ob7cFzhS1mXzXQVyYC?usp=sharing

A supplementary Aadhaar-specific dataset ("new_generated_aadharcard_images") of
front/backside card images with several augmentation variants applied to each
source image (blurred, contrast-adjusted, hue/saturation-adjusted, scaled down,
scaled up). Used to expand and diversify the Aadhaar training data beyond the raw
images in dataset #1.

## 3. KYC Dataset (train / val / processed split)

**Link:** https://drive.google.com/drive/folders/1QW6-Bsfch34aLlxwYTOATMwg_VOtoc9K

A Google Drive folder named "KYC Dataset", pre-split into:

- `train`
- `val`
- `processed`

This is the organized/split dataset structure used for model training and
validation.

## 4. PAN Card Dataset (Kaggle)

**Link:** https://www.kaggle.com/datasets/nagendra048/pan-card-dataset

An external, third-party PAN card image dataset hosted on Kaggle, used to
supplement the PAN card training data. Requires a (free) Kaggle account to
download. See Kaggle's own page for that dataset's license/usage terms, which
apply independently of this project's license.

## Using these datasets

- **To run the app as-is:** you don't need any of these — the app uses the
  already-trained model artifact (`trained models/kyc_classifier.tflite`) and does
  not load these raw datasets at runtime.
- **To retrain or extend the classifier:** download the folders above into a local
  `dataset/` directory (gitignored — not tracked in this repo) and refer to the
  notebooks in `notebooks/` for the preprocessing and training steps that were used.

## License / usage note

These datasets were sourced from Google Drive (public "anyone with the link" shares)
and Kaggle. They are referenced here for transparency and reproducibility of this
project's training process. Redistribution or use beyond this project's academic
scope is subject to each original dataset's own terms.
