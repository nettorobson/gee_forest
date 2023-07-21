// GEE - Google Earth Engine + Google's 'Dynamic World' database.
// This script was tested to run in a GEE environment.
// Script to portrait the scenario when the forest recovering project begun (2015-2016).

// The readme file contains te methodological approach and project scenario.
// The comments in this script explains the code features.


// First of all we import the target area as an asset: 
// The shapefile is uploaded to the GEE environment and imported to teh script as a variable named 'table'
// For this reason it's not necessary to re-declare 'table'

//// PART ONE: PREPARING THE IMAGE

// Setting a Time Interval.
var startDate = '2015-07-15';
var endDate = '2016-07-25';

// Loading the Sentinel-2B Image
var s2 = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
             .filterDate(startDate, endDate)
             .filterBounds(table)
             .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10)) // Setting the max cloud coverage value
             .map(function(image){return image.clip(table)}); // Clipping only the target area (table)
             
// Filtering the earliest image after the earlier filter, and adding to the map
var s2Image = ee.Image(s2.first());
var s2VisParams = {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}; // Bands selected from the Copernicus Sentinel 2B features 
Map.addLayer(s2Image, s2VisParams, 'Sentinel-2 Image');
Map.centerObject(table, 13);

// Finding the matching Dynamic World image
var imageId = s2Image.get('system:index');
print(imageId);

// Applying a filter on the Dynamic World collection and extracting the matching scene
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
             .filterBounds(table)
             .filter(ee.Filter.eq('system:index', imageId))
             .map(function(image){return image.clip(table)}); // Clipping only the target area (table)
var dwImage = ee.Image(dw.first());
print(dwImage);

// At this step you could check GEE console. It should display the information about the Dynamic World image previously filtered.

// Visualizing the Classified Image using the label band:
// (For more details, please check the documentation at DW tutorial Part 1)
var classification = dwImage.select('label');
var dwVisParams = {
  min: 0,
  max: 8,
  palette: [
    '#419BDF', '#397D49', '#88B053', '#7A87C6', '#E49635', '#DFC35A',
    '#C4281B', '#A59B8F', '#B39FE1'
  ]
};

Map.addLayer(classification, dwVisParams, 'Classified Image');

// Creating a Probability Hillshade visualization
var probabilityBands = [
  'water', 'trees', 'grass', 'flooded_vegetation', 'crops', 'shrub_and_scrub',
  'built', 'bare', 'snow_and_ice'
];

var probabilityImage = dwImage.select(probabilityBands);

// Creating the image with the highest probability value at each pixel.
var top1Probability = probabilityImage.reduce(ee.Reducer.max());
// Converting the probability values to integers.
var top1Confidence = top1Probability.multiply(100).int();
// Computing the hillshade.
var hillshade = ee.Terrain.hillshade(top1Confidence).divide(255);
// Colorizing the classification image.
var rgbImage = classification.visualize(dwVisParams).divide(255);

// Colorizing the hillshade.
var probabilityHillshade = rgbImage.multiply(hillshade);

var hillshadeVisParams = {min: 0, max: 0.8};
Map.addLayer(probabilityHillshade, hillshadeVisParams, 'Probability Hillshade');

//// PART 2: CALCULATING STATISTICS

// Creating a mode composite (Best format for the next steps)
var classification = dw.select('label');
var dwComposite = classification.reduce(ee.Reducer.mode());

// Extracting the FOREST class, the target class for this project.
var forestArea = dwComposite.eq(1);

// The result is a binary image with pixel values: '1' where the condition is matching and '0' where it didn't.
// We can add both the composite and the forest area images to the Map to visualize it:
var dwVisParams = {
  min: 0,
  max: 8,
  palette: [
    '#419BDF', '#397D49', '#88B053', '#7A87C6', '#E49635', '#DFC35A',
    '#C4281B', '#A59B8F', '#B39FE1'
  ]
};

// Clipping the composite and adding it to the Map.
Map.addLayer(dwComposite.clip(table), dwVisParams, 'Classified Composite');
Map.addLayer(forestArea.clip(table), {}, 'Forest Areas');

// Renaming image bands to make it easier to keep track of them
var dwComposite = dwComposite.rename(['classification']);
var forestArea = forestArea.rename(['forest_area']);

// Counting all pixels (Please check GEE Console after running the code)
var statsTotal = forestArea.reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: table, // Here 'table' refers to the geometry class, not the target area. 
    scale: 10,
    maxPixels: 1e10
    });
var totalPixels = statsTotal.get('forest_area');

// Masking 0 pixel values and counting remaining pixels.
var forestAreaMasked = forestArea.selfMask();

var statsMasked = forestAreaMasked.reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: table, // Here 'table' refers to the geometry class, not the target area.
    scale: 10,
    maxPixels: 1e10
    });
var forestAreaPixels = statsMasked.get('forest_area');
print(forestAreaPixels); // Results displayed on the GEE Console

// Calculatign the forest area fraction (rounded by 2 decimals)
var fraction = (ee.Number(forestAreaPixels).divide(totalPixels))
  .multiply(100);
print('Percentage Forest Area', fraction.format('%.2f'));

// Summarizing Pixel Counts for All Classes:
// Using a reducer "frequencyHistogram()" to compute the counts for all unique pixel values in the image.
var pixelCountStats = dwComposite.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram().unweighted(),
    geometry: table,
    scale: 10,
    maxPixels: 1e10
    });

var pixelCounts = ee.Dictionary(pixelCountStats.get('classification'));
print(pixelCounts);

// Creating a list for the class names ('Snow & Ice' not included):
var classLabels = ee.List([
    'water', 'trees', 'grass', 'crops',
    'shrub_and_scrub', 'built', 'bare'
    ]);

// Renaming keys with class names.
var pixelCountsFormatted = pixelCounts.rename(
  pixelCounts.keys(), classLabels);
print(pixelCountsFormatted);

// Converting the dictionary into a Feature Collection.
var exportFc = ee.FeatureCollection(
  ee.Feature(null, pixelCountsFormatted));

// Exporting the results as a CSV file.
Export.table.toDrive({
  collection: exportFc,
  description: 'pixel_counts_export',
  folder: 'earthengine',
  fileNamePrefix: 'pixel_counts_aa01',
  fileFormat: 'CSV',
});

//// PART THREE: EXPORTING THE IMAGES AS A GEOTIFF

// Composite 2D
// (If you want to further analyze this dataset with GIS software, you can export the raw image with the pixel values representing classes)
Export.image.toDrive({
  image: dwComposite.clip(table),
  description: 'aa01_2015-16_dw_composite_raw',
  region: table,
  scale: 10,
  maxPixels: 1e10
});

// Top-1 Probability Hillshade Composite:
// (if you wish to create a map using this composite or use it as a background map)
var hillshadeComposite = probabilityHillshade.visualize(hillshadeVisParams);

Export.image.toDrive({
  image: hillshadeComposite.clip(table),
  description: 'aa01_2015-16_dw_composite_hillshade',
  region: table,
  scale: 10,
  maxPixels: 1e10
});